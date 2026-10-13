import { describe, expect, it } from 'vitest'
import { fakeHrIban, fakeIban, fakeOib, createRng } from '../../../tests/helpers/fake'
import {
  changeMemberRoleSchema,
  createOrganizationSchema,
  fieldErrors,
  inviteMemberSchema,
  isNonHrIban,
  updateObrtProfileSchema,
} from './schemas'

const rng = createRng(4242)

function valid(overrides: Record<string, unknown> = {}) {
  return {
    tradeName: '  Obrt Test  ',
    ownerFullName: ' Ana Test ',
    oib: fakeOib(rng),
    street: 'Testna 1',
    postalCode: '10000',
    city: 'Zagreb',
    countryCode: 'HR',
    iban: fakeHrIban(rng),
    email: 'Obrt@Example.Test',
    phone: '',
    website: '',
    defaultInvoiceNote: 'Napomena',
    declareNotInVat: true,
    ...overrides,
  }
}

function errorsOf(input: unknown) {
  const result = createOrganizationSchema.safeParse(input)
  return result.success ? {} : fieldErrors(result.error)
}

describe('createOrganizationSchema', () => {
  it('accepts valid input and trims, normalizes and nulls empty optionals', () => {
    const iban = fakeHrIban(rng)
    const oib = fakeOib(rng)
    const result = createOrganizationSchema.parse(
      valid({
        iban: iban.toLowerCase().replace(/(.{4})/g, '$1 '),
        oib: ` ${oib.slice(0, 4)} ${oib.slice(4)} `,
      }),
    )
    expect(result).toMatchObject({
      tradeName: 'Obrt Test',
      ownerFullName: 'Ana Test',
      oib,
      iban,
      email: 'obrt@example.test',
      phone: null,
      website: null,
      countryCode: 'HR',
      declareNotInVat: true,
    })
  })

  it('defaults the country to HR and accepts it in lower case', () => {
    expect(createOrganizationSchema.parse(valid({ countryCode: undefined })).countryCode).toBe('HR')
    expect(createOrganizationSchema.parse(valid({ countryCode: ' hr ' })).countryCode).toBe('HR')
  })

  it.each([
    ['oib', { oib: '12345678900' }, 'Neispravan OIB.'],
    ['oib', { oib: '1234567890' }, 'Neispravan OIB.'],
    ['oib', { oib: 'abcdefghijk' }, 'Neispravan OIB.'],
    ['oib', { oib: '' }, 'Obavezno polje.'],
    ['iban', { iban: 'HR1210010051863000161' }, 'Neispravan IBAN.'],
    ['iban', { iban: 'HR121001005186300016' }, 'Neispravan IBAN.'],
    ['iban', { iban: '' }, 'Obavezno polje.'],
    ['postalCode', { postalCode: '1000' }, 'Poštanski broj mora imati 5 znamenki.'],
    ['postalCode', { postalCode: '100000' }, 'Poštanski broj mora imati 5 znamenki.'],
    ['postalCode', { postalCode: '1000a' }, 'Poštanski broj mora imati 5 znamenki.'],
    ['countryCode', { countryCode: 'DE' }, 'Trenutno je podržana samo Hrvatska.'],
    ['tradeName', { tradeName: '   ' }, 'Obavezno polje.'],
    ['tradeName', { tradeName: 'x'.repeat(201) }, 'Najviše 200 znakova.'],
    ['city', { city: 'x'.repeat(101) }, 'Najviše 100 znakova.'],
    ['email', { email: 'nije-mail' }, 'Unesite ispravnu adresu e-pošte.'],
    ['website', { website: 'ftp://x.test' }, 'Unesite ispravan URL, npr. https://primjer.hr.'],
    ['website', { website: 'bez sheme' }, 'Unesite ispravan URL, npr. https://primjer.hr.'],
  ])('rejects %s %j', (field, override, message) => {
    expect(errorsOf(valid(override))[field]).toBe(message)
  })

  it('requires declareNotInVat to be literally true', () => {
    const message = 'Aplikacija je trenutno namijenjena paušalistima izvan sustava PDV-a.'
    for (const value of [false, undefined, 'true', 'on', 1, null]) {
      expect(errorsOf(valid({ declareNotInVat: value })).declareNotInVat, String(value)).toBe(
        message,
      )
    }
  })

  it('has no in_vat_system input: a posted value is dropped', () => {
    const parsed = createOrganizationSchema.parse(valid({ inVatSystem: true, in_vat_system: true }))
    expect(parsed).not.toHaveProperty('inVatSystem')
    expect(parsed).not.toHaveProperty('in_vat_system')
  })

  it('reports non-string input as required, not as a crash', () => {
    expect(errorsOf(valid({ tradeName: null, oib: undefined, iban: 5 }))).toMatchObject({
      tradeName: 'Obavezno polje.',
      oib: 'Obavezno polje.',
      iban: 'Obavezno polje.',
    })
  })
})

describe('updateObrtProfileSchema', () => {
  it('has no OIB: a posted oib is dropped', () => {
    const { oib: _oib, declareNotInVat: _declare, ...fields } = valid()
    void _oib
    void _declare
    const parsed = updateObrtProfileSchema.parse({
      ...fields,
      orgSlug: 'moj-obrt',
      oib: fakeOib(rng),
    })
    expect(parsed).not.toHaveProperty('oib')
    expect(parsed.orgSlug).toBe('moj-obrt')
  })

  it('rejects a malformed organization slug', () => {
    const { oib: _oib, ...fields } = valid()
    void _oib
    for (const orgSlug of ['', 'A', '-x', 'a b', '../x', undefined]) {
      expect(
        updateObrtProfileSchema.safeParse({ ...fields, orgSlug }).success,
        String(orgSlug),
      ).toBe(false)
    }
  })
})

describe('member schemas', () => {
  it('invitations only for accountant and member, with a lower-cased address', () => {
    const ok = inviteMemberSchema.parse({
      orgSlug: 'x',
      email: ' A@Example.Test ',
      role: 'accountant',
    })
    expect(ok.email).toBe('a@example.test')
    for (const role of ['owner', 'admin', '', undefined, 'member,owner']) {
      expect(
        inviteMemberSchema.safeParse({ orgSlug: 'x', email: 'a@example.test', role }).success,
      ).toBe(false)
    }
    expect(
      inviteMemberSchema.safeParse({ orgSlug: 'x', email: 'nope', role: 'member' }).success,
    ).toBe(false)
  })

  it('role changes accept the three roles only', () => {
    for (const role of ['owner', 'accountant', 'member']) {
      expect(
        changeMemberRoleSchema.safeParse({ orgSlug: 'x', memberId: 'abc123', role }).success,
      ).toBe(true)
    }
    expect(
      changeMemberRoleSchema.safeParse({ orgSlug: 'x', memberId: 'abc123', role: 'root' }).success,
    ).toBe(false)
    expect(
      changeMemberRoleSchema.safeParse({ orgSlug: 'x', memberId: 'a b', role: 'member' }).success,
    ).toBe(false)
    expect(
      changeMemberRoleSchema.safeParse({ orgSlug: 'x', memberId: 'a'.repeat(65), role: 'member' })
        .success,
    ).toBe(false)
  })
})

describe('isNonHrIban', () => {
  it('flags valid IBANs of other countries only', () => {
    expect(isNonHrIban(fakeHrIban(rng))).toBe(false)
    expect(isNonHrIban(fakeIban(rng, 'DE'))).toBe(true)
    expect(isNonHrIban('')).toBe(false)
  })
})
