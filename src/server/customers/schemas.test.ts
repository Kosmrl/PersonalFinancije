import { describe, expect, it } from 'vitest'
import { createRng, fakeOib } from '../../../tests/helpers/fake'
import { customerSchema } from './schemas'

// Validation rules of the customer form (plan: "customers" table, Test plan item 10). Made-up
// data only; OIBs are generated with a valid check digit.

const rng = createRng()
const oib = fakeOib(rng)

function parse(input: Record<string, unknown>) {
  return customerSchema.safeParse({ countryCode: 'HR', ...input })
}

function errorsOf(input: Record<string, unknown>): Record<string, string> {
  const result = parse(input)
  if (result.success) return {}
  const out: Record<string, string> = {}
  for (const issue of result.error.issues) out[String(issue.path[0])] ??= issue.message
  return out
}

describe('customerSchema', () => {
  it('requires an OIB for a Croatian business', () => {
    const errors = errorsOf({
      kind: 'business',
      name: 'Primjer d.o.o.',
      street: 'Ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
    })
    expect(errors.oib).toBe('OIB je obavezan za hrvatski poslovni subjekt.')
  })

  it('accepts a person without an OIB', () => {
    const result = parse({ kind: 'person', name: 'Ana Primjer' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.oib).toBeNull()
  })

  it('drops an OIB posted for a person (not collected)', () => {
    const result = parse({ kind: 'person', name: 'Ana Primjer', oib })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.oib).toBeNull()
  })

  it('rejects an OIB with a wrong check digit', () => {
    const wrong = oib.slice(0, 10) + String((oib.charCodeAt(10) - 47) % 10)
    const errors = errorsOf({
      kind: 'business',
      name: 'Primjer d.o.o.',
      oib: wrong,
      street: 'Ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
    })
    expect(errors.oib).toBe('Neispravan OIB.')
  })

  it('strips spaces from the OIB', () => {
    const result = parse({
      kind: 'business',
      name: 'Primjer d.o.o.',
      oib: ` ${oib.slice(0, 5)} ${oib.slice(5)} `,
      street: 'Ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
    })
    expect(result.success && result.data.oib).toBe(oib)
  })

  it('upper-cases a foreign business VAT ID and removes spaces', () => {
    const result = parse({
      kind: 'business',
      name: 'Beispiel GmbH',
      countryCode: 'DE',
      vatId: 'de 123456789',
      street: 'Hauptstrasse 1',
      postalCode: '10115',
      city: 'Berlin',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.vatId).toBe('DE123456789')
      expect(result.data.oib).toBeNull()
    }
  })

  it('rejects a malformed VAT ID', () => {
    const errors = errorsOf({
      kind: 'business',
      name: 'Beispiel GmbH',
      countryCode: 'DE',
      vatId: '12345',
      street: 'Hauptstrasse 1',
      postalCode: '10115',
      city: 'Berlin',
    })
    expect(errors.vatId).toMatch(/PDV ID/)
  })

  it('ignores a VAT ID for a Croatian business', () => {
    const result = parse({
      kind: 'business',
      name: 'Primjer d.o.o.',
      oib,
      vatId: 'HR12345678901',
      street: 'Ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
    })
    expect(result.success && result.data.vatId).toBeNull()
  })

  it('requires the whole address for a business', () => {
    const errors = errorsOf({ kind: 'business', name: 'X d.o.o.', oib })
    expect(errors.street).toBe('Obavezno polje.')
    expect(errors.postalCode).toBe('Obavezno polje.')
    expect(errors.city).toBe('Obavezno polje.')
  })

  it('stores a partial person address as given', () => {
    const partial = parse({ kind: 'person', name: 'Ana', street: 'Ulica 1' })
    expect(partial.success && partial.data.street).toBe('Ulica 1')
    expect(partial.success && partial.data.city).toBeNull()
    const full = parse({
      kind: 'person',
      name: 'Ana',
      street: 'Ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
    })
    expect(full.success && full.data.street).toBe('Ulica 1')
  })

  it('requires a 5-digit postal code in Croatia only', () => {
    expect(errorsOf({ kind: 'person', name: 'Ana', postalCode: '1000' }).postalCode).toMatch(
      /5 znamenki/,
    )
    expect(
      errorsOf({ kind: 'person', name: 'Ana', countryCode: 'GB', postalCode: 'SW1A 1AA' }),
    ).toEqual({})
  })

  it('rejects a country outside the fixed list and a missing name', () => {
    expect(errorsOf({ kind: 'person', name: 'Ana', countryCode: 'XX' }).countryCode).toBeDefined()
    expect(errorsOf({ kind: 'person', name: '   ' }).name).toBe('Obavezno polje.')
  })

  it('normalises the e-mail and turns empty optional fields into null', () => {
    const result = parse({ kind: 'person', name: 'Ana', email: ' Ana@Example.TEST ', note: '  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('ana@example.test')
      expect(result.data.note).toBeNull()
    }
    expect(errorsOf({ kind: 'person', name: 'Ana', email: 'nije-adresa' }).email).toBeDefined()
  })

  describe('edge cases', () => {
    const addr = { street: 'Ulica 1', postalCode: '10000', city: 'Zagreb' }

    it('enforces name length 200 / 201 and keeps diacritics', () => {
      expect(errorsOf({ kind: 'person', name: 'a'.repeat(200) })).toEqual({})
      expect(errorsOf({ kind: 'person', name: 'a'.repeat(201) }).name).toBe('Najviše 200 znakova.')
      const result = parse({ kind: 'person', name: '  Čačić Đurđica Šišmiš Žalac  ' })
      expect(result.success && result.data.name).toBe('Čačić Đurđica Šišmiš Žalac')
    })

    it('enforces note length 1000 / 1001', () => {
      expect(errorsOf({ kind: 'person', name: 'Ana', note: 'n'.repeat(1000) })).toEqual({})
      expect(errorsOf({ kind: 'person', name: 'Ana', note: 'n'.repeat(1001) }).note).toBe(
        'Najviše 1000 znakova.',
      )
    })

    it('rejects an e-mail longer than 254 characters', () => {
      const long = `${'a'.repeat(250)}@example.test`
      expect(errorsOf({ kind: 'person', name: 'Ana', email: long }).email).toBeDefined()
    })

    it('rejects an invalid or missing kind and non-string names', () => {
      expect(errorsOf({ kind: 'company', name: 'X' }).kind).toBe('Odaberite vrstu kupca.')
      expect(errorsOf({ name: 'X' }).kind).toBe('Odaberite vrstu kupca.')
      expect(errorsOf({ kind: 'person', name: 123 }).name).toBe('Obavezno polje.')
      expect(errorsOf({ kind: 'person' }).name).toBe('Obavezno polje.')
    })

    it('defaults the country to HR and upper-cases a lower-case code', () => {
      const missing = customerSchema.safeParse({ kind: 'person', name: 'Ana' })
      expect(missing.success && missing.data.countryCode).toBe('HR')
      const lower = parse({ kind: 'person', name: 'Ana', countryCode: ' de ' })
      expect(lower.success && lower.data.countryCode).toBe('DE')
    })

    it('rejects OIBs that are too short, too long or contain letters', () => {
      for (const bad of [oib.slice(0, 10), `${oib}1`, `${oib.slice(0, 10)}x`, 'abcdefghijk']) {
        expect(errorsOf({ kind: 'business', name: 'X', oib: bad, ...addr }).oib).toBe(
          'Neispravan OIB.',
        )
      }
    })

    it('treats an all-whitespace OIB as missing for an HR business', () => {
      expect(errorsOf({ kind: 'business', name: 'X', oib: '   ', ...addr }).oib).toMatch(
        /obavezan/,
      )
    })

    it('keeps a valid OIB and rejects an invalid one for a foreign business', () => {
      const foreign = { kind: 'business', name: 'GmbH', countryCode: 'DE', ...addr }
      const kept = parse({ ...foreign, postalCode: '10115', oib })
      expect(kept.success && kept.data.oib).toBe(oib)
      expect(errorsOf({ ...foreign, oib: '123' }).oib).toBe('Neispravan OIB.')
    })

    it('does not require a VAT ID or an OIB for a foreign business', () => {
      const result = parse({
        kind: 'business',
        name: 'GmbH',
        countryCode: 'DE',
        street: 'Str 1',
        postalCode: '10115',
        city: 'Berlin',
      })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.vatId).toBeNull()
    })

    it('drops a VAT ID posted for a person', () => {
      const result = parse({ kind: 'person', name: 'Ana', countryCode: 'DE', vatId: 'DE123456789' })
      expect(result.success && result.data.vatId).toBeNull()
    })

    it('VAT ID boundaries: 4 and 15 characters ok, 3 and 16 rejected', () => {
      const foreign = { kind: 'business', name: 'GmbH', countryCode: 'DE', ...addr }
      expect(errorsOf({ ...foreign, vatId: 'DE12' }).vatId).toBeUndefined()
      expect(errorsOf({ ...foreign, vatId: `DE${'1'.repeat(13)}` }).vatId).toBeUndefined()
      expect(errorsOf({ ...foreign, vatId: 'DE1' }).vatId).toBeDefined()
      expect(errorsOf({ ...foreign, vatId: `DE${'1'.repeat(14)}` }).vatId).toBeDefined()
      expect(errorsOf({ ...foreign, vatId: 'DE_123456' }).vatId).toBeDefined()
    })

    it('rejects Croatian postal codes with letters, 6 digits or only spaces inside', () => {
      for (const bad of ['1000a', '100000', '10 00']) {
        expect(errorsOf({ kind: 'person', name: 'Ana', postalCode: bad }).postalCode).toMatch(
          /5 znamenki/,
        )
      }
    })

    it('keeps the parts of a partial person address', () => {
      const result = parse({ kind: 'person', name: 'Ana', street: 'Ulica 1', city: 'Zagreb' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect([result.data.street, result.data.postalCode, result.data.city]).toEqual([
          'Ulica 1',
          null,
          'Zagreb',
        ])
      }
    })

    it('strips dots and hyphens from a VAT ID before validating', () => {
      const foreign = { kind: 'business', name: 'GmbH', countryCode: 'DE', ...addr }
      const result = parse({ ...foreign, postalCode: '10115', vatId: 'de-123.456 789' })
      expect(result.success && result.data.vatId).toBe('DE123456789')
    })

    it('rejects control characters in name, street and city but allows newlines in the note', () => {
      const code = String.fromCharCode
      for (const bad of ['a'+code(10)+'b', 'a'+code(9)+'b', 'a'+code(13)+'b', 'a'+code(0)+'b', 'a'+code(127)+'b']) {
        expect(errorsOf({ kind: 'person', name: bad }).name).toBe('Unos sadrži nedozvoljene znakove.')
        expect(errorsOf({ kind: 'person', name: 'Ana', street: bad }).street).toBeDefined()
        expect(errorsOf({ kind: 'person', name: 'Ana', city: bad }).city).toBeDefined()
      }
      const withBreak = 'red 1'+code(10)+'red 2'
      const note = parse({ kind: 'person', name: 'Ana', note: withBreak })
      expect(note.success && note.data.note).toBe(withBreak)
    })

    it('ignores unknown keys such as organizationId and archivedAt', () => {
      const result = parse({
        kind: 'person',
        name: 'Ana',
        organizationId: 'other-org',
        archivedAt: '2020-01-01',
        id: 'x',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Object.keys(result.data).sort()).toEqual(
          ['city', 'countryCode', 'email', 'kind', 'name', 'note', 'oib', 'postalCode', 'street', 'vatId'].sort(),
        )
      }
    })

    it('treats null optional fields like absent ones', () => {
      const result = parse({
        kind: 'person',
        name: 'Ana',
        oib: null,
        vatId: null,
        street: null,
        email: null,
        note: null,
      })
      expect(result.success).toBe(true)
    })
  })
})
