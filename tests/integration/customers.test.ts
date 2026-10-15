import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { createRng, fakeOib, freshSeed } from '../helpers/fake'
import { addMember, appPool, asTenant, createOrg, createUser, ownerPool } from '../helpers/db'
import { testOrgContext } from '../helpers/org-context'
import type { OrgContext } from '@/server/auth/context'

// The customer actions and queries against the real database (RLS, partial unique index, audit
// trigger). Only Next's request APIs are mocked, and requireOrgContext: it is replaced by a lookup
// in a map of pre-minted contexts, so the tests choose "who is signed in" per call. A slug that is
// not in the map behaves like a non-member (notFound). The real requireOrgContext is covered by
// org-actions.test.ts.

const mocks = vi.hoisted(() => ({ contexts: new Map<string, unknown>() }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && /^NEXT_(NOT_FOUND|REDIRECT)/.test(error.message)) throw error
  },
}))
vi.mock('@/server/auth/context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/auth/context')>()
  return {
    ...original,
    requireOrgContext: async (slug: string) => {
      const ctx = mocks.contexts.get(slug)
      if (!ctx) throw new Error('NEXT_NOT_FOUND')
      return { ok: true, ctx }
    },
  }
})

describe('customers', () => {
  const owner = ownerPool()
  const app = appPool()
  const rng = createRng(freshSeed())

  let actions: typeof import('@/server/customers/actions')
  let queries: typeof import('@/server/customers/queries')
  let client: typeof import('@/server/db/client')

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    process.env.BETTER_AUTH_SECRET = randomBytes(24).toString('hex')
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.SMTP_HOST = 'localhost'
    process.env.MAIL_FROM = 'test@example.test'
    actions = await import('@/server/customers/actions')
    queries = await import('@/server/customers/queries')
    client = await import('@/server/db/client')
  })
  afterAll(async () => {
    await client.getPool().end()
    await app.end()
    await owner.end()
  })

  type Tenant = { ctx: OrgContext; orgId: string; slug: string }

  async function makeTenant(role: 'owner' | 'accountant' | 'member' = 'owner'): Promise<Tenant> {
    const org = await createOrg(owner)
    const user = await createUser(owner)
    await addMember(owner, org.id, user.id, role)
    const ctx = testOrgContext({ orgId: org.id, orgSlug: org.slug, userId: user.id, role })
    mocks.contexts.set(org.slug, ctx)
    return { ctx, orgId: org.id, slug: org.slug }
  }

  const person = (overrides: Record<string, unknown> = {}) => ({
    kind: 'person',
    name: 'Ana Primjer',
    countryCode: 'HR',
    ...overrides,
  })
  const business = (oib: string, overrides: Record<string, unknown> = {}) => ({
    kind: 'business',
    name: 'Primjer d.o.o.',
    oib,
    street: 'Testna ulica 1',
    postalCode: '10000',
    city: 'Zagreb',
    countryCode: 'HR',
    ...overrides,
  })

  async function create(t: Tenant, fields: Record<string, unknown>) {
    return actions.createCustomer({ orgSlug: t.slug, ...fields })
  }

  async function rowOf(t: Tenant, id: string) {
    return asTenant(app, t.orgId, async (c) => {
      const { rows } = await c.query(`select * from customers where id = $1`, [id])
      return rows[0] as Record<string, unknown> | undefined
    })
  }

  async function audit(t: Tenant) {
    return asTenant(app, t.orgId, async (c) => {
      const { rows } = await c.query<{
        action: string
        entity_type: string
        entity_id: string
        changed_fields: string[]
      }>(
        `select action, entity_type, entity_id, changed_fields
           from audit_log where organization_id = $1 order by id`,
        [t.orgId],
      )
      return rows
    })
  }

  it('returns field errors for an HR business without an OIB', async () => {
    const t = await makeTenant()
    const result = await create(t, business('', { oib: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fieldErrors?.oib).toMatch(/OIB je obavezan/)
    expect(await audit(t)).toEqual([])
  })

  it('creates a person without an OIB and stores none even if one is posted', async () => {
    const t = await makeTenant()
    const result = await create(t, person({ oib: fakeOib(rng) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = await rowOf(t, result.data.customerId)
    expect(row?.oib).toBeNull()
    expect(row?.organization_id).toBe(t.orgId)
  })

  it('stores a foreign VAT ID upper-cased', async () => {
    const t = await makeTenant()
    const result = await create(
      t,
      business('', {
        oib: '',
        countryCode: 'DE',
        vatId: 'de 123456789',
        postalCode: '10115',
        city: 'Berlin',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await rowOf(t, result.data.customerId))?.vat_id).toBe('DE123456789')
  })

  it('refuses a duplicate active OIB in the same organization with the plan message', async () => {
    const t = await makeTenant()
    const oib = fakeOib(rng)
    expect((await create(t, business(oib))).ok).toBe(true)
    const again = await create(t, business(oib, { name: 'Drugi d.o.o.' }))
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.message).toBe('Kupac s tim OIB-om već postoji.')
      expect(again.fieldErrors?.oib).toBe('Kupac s tim OIB-om već postoji.')
    }
    // Only the first creation was audited.
    expect((await audit(t)).map((row) => row.action)).toEqual(['customer.created'])
  })

  it('allows the same OIB in a different organization', async () => {
    const a = await makeTenant()
    const b = await makeTenant()
    const oib = fakeOib(rng)
    expect((await create(a, business(oib))).ok).toBe(true)
    expect((await create(b, business(oib))).ok).toBe(true)
  })

  it('allows a new customer with the OIB of an archived one, and refuses restoring the old one', async () => {
    const t = await makeTenant()
    const oib = fakeOib(rng)
    const first = await create(t, business(oib))
    if (!first.ok) throw new Error('setup failed')
    const archive = await actions.archiveCustomer({
      orgSlug: t.slug,
      customerId: first.data.customerId,
    })
    expect(archive.ok).toBe(true)

    const second = await create(t, business(oib, { name: 'Novi d.o.o.' }))
    expect(second.ok).toBe(true)

    const restore = await actions.restoreCustomer({
      orgSlug: t.slug,
      customerId: first.data.customerId,
    })
    expect(restore.ok).toBe(false)
    if (!restore.ok) expect(restore.message).toBe('Kupac s tim OIB-om već postoji.')
    expect((await rowOf(t, first.data.customerId))?.archived_at).not.toBeNull()
  })

  it('refuses changing an OIB to one another active customer has', async () => {
    const t = await makeTenant()
    const oibA = fakeOib(rng)
    const oibB = fakeOib(rng)
    await create(t, business(oibA))
    const b = await create(t, business(oibB, { name: 'B d.o.o.' }))
    if (!b.ok) throw new Error('setup failed')
    const result = await actions.updateCustomer({
      orgSlug: t.slug,
      customerId: b.data.customerId,
      ...business(oibA, { name: 'B d.o.o.' }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fieldErrors?.oib).toBe('Kupac s tim OIB-om već postoji.')
  })

  it('audits field names only, never values', async () => {
    const t = await makeTenant()
    const oib = fakeOib(rng)
    const created = await create(t, business(oib, { email: 'kupac@example.test' }))
    if (!created.ok) throw new Error('setup failed')
    const id = created.data.customerId
    await actions.updateCustomer({
      orgSlug: t.slug,
      customerId: id,
      ...business(oib, { email: 'kupac@example.test', city: 'Split', postalCode: '21000' }),
    })
    // No change: no audit row.
    await actions.updateCustomer({
      orgSlug: t.slug,
      customerId: id,
      ...business(oib, { email: 'kupac@example.test', city: 'Split', postalCode: '21000' }),
    })
    await actions.archiveCustomer({ orgSlug: t.slug, customerId: id })
    await actions.archiveCustomer({ orgSlug: t.slug, customerId: id })
    await actions.restoreCustomer({ orgSlug: t.slug, customerId: id })

    const rows = await audit(t)
    expect(rows.map((row) => row.action)).toEqual([
      'customer.created',
      'customer.updated',
      'customer.archived',
      'customer.restored',
    ])
    expect(rows[1]?.changed_fields.sort()).toEqual(['city', 'postalCode'])
    expect(rows.every((row) => row.entity_type === 'customer' && row.entity_id === id)).toBe(true)
    const dump = JSON.stringify(rows)
    for (const value of [oib, 'kupac@example.test', 'Primjer', 'Split']) {
      expect(dump).not.toContain(value)
    }
  })

  it('refuses editing an archived customer', async () => {
    const t = await makeTenant()
    const created = await create(t, person())
    if (!created.ok) throw new Error('setup failed')
    const id = created.data.customerId
    await actions.archiveCustomer({ orgSlug: t.slug, customerId: id })
    const result = await actions.updateCustomer({
      orgSlug: t.slug,
      customerId: id,
      ...person({ name: 'Promijenjeno' }),
    })
    expect(result.ok).toBe(false)
    expect((await rowOf(t, id))?.name).toBe('Ana Primjer')
  })

  it('treats another organization as not found and changes nothing there', async () => {
    const a = await makeTenant()
    const created = await create(a, person())
    if (!created.ok) throw new Error('setup failed')
    const id = created.data.customerId

    // A slug the caller is not a member of (not in the context map).
    const strangerSlug = `test-${randomBytes(6).toString('hex')}`
    await expect(
      actions.archiveCustomer({ orgSlug: strangerSlug, customerId: id }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(
      actions.updateCustomer({ orgSlug: strangerSlug, customerId: id, ...person() }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect((await rowOf(a, id))?.archived_at).toBeNull()

    // A member of another organization using the id of A's customer: the row is invisible.
    const b = await makeTenant()
    const result = await actions.archiveCustomer({ orgSlug: b.slug, customerId: id })
    expect(result.ok).toBe(false)
    expect((await rowOf(a, id))?.archived_at).toBeNull()
    await expect(queries.getCustomer(b.ctx, id)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(queries.getCustomer(a.ctx, id)).resolves.toMatchObject({ id })
  })

  it('lets every role create customers', async () => {
    for (const role of ['accountant', 'member'] as const) {
      const t = await makeTenant(role)
      expect((await create(t, person())).ok).toBe(true)
    }
  })

  it('rejects a malformed customer id without touching the database', async () => {
    const t = await makeTenant()
    const result = await actions.archiveCustomer({ orgSlug: t.slug, customerId: 'nope' })
    expect(result.ok).toBe(false)
    await expect(queries.getCustomer(t.ctx, 'nope')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  describe('searchCustomers', () => {
    it('searches by name, OIB and e-mail for members and is scoped to the organization', async () => {
      const a = await makeTenant('member')
      const b = await makeTenant()
      const oib = fakeOib(rng)
      await create(a, business(oib, { name: 'Firma d.o.o.' }))
      await create(a, person({ name: 'Pero', email: 'pero@example.test' }))
      await create(b, person({ name: 'Pero Tuđi' }))

      const search = async (q: unknown) => {
        const result = await actions.searchCustomers({ orgSlug: a.slug, q })
        if (!result.ok) throw new Error('search failed')
        return result.data.rows.map((row) => row.name)
      }
      expect(await search('pero')).toEqual(['Pero'])
      expect(await search(oib.slice(1, 7))).toEqual(['Firma d.o.o.'])
      expect(await search('PERO@EXAMPLE')).toEqual(['Pero'])
      expect(await search(42)).toHaveLength(2)
    })

    it('refuses a stranger without leaking rows', async () => {
      const a = await makeTenant()
      await expect(
        actions.searchCustomers({ orgSlug: 'not-a-member', q: 'a' }),
      ).rejects.toThrow('NEXT_NOT_FOUND')
      expect(a.slug).toBeTruthy()
    })
  })

  describe('listCustomers', () => {
    it('escapes % and _ in the search and matches name, OIB and e-mail', async () => {
      const t = await makeTenant()
      const oib = fakeOib(rng)
      await create(t, person({ name: 'Popust 50% Ana' }))
      await create(t, person({ name: 'Popust 500 Ivo' }))
      await create(t, person({ name: 'Pero_Peric' }))
      await create(t, person({ name: 'Pero Peric', email: 'pero@example.test' }))
      await create(t, business(oib, { name: 'Firma d.o.o.' }))

      const names = async (q: string) =>
        (await queries.listCustomers(t.ctx, { q })).rows.map((row) => row.name)

      expect(await names('50%')).toEqual(['Popust 50% Ana'])
      expect(await names('%')).toEqual(['Popust 50% Ana'])
      expect(await names('Pero_')).toEqual(['Pero_Peric'])
      expect(await names('_')).toEqual(['Pero_Peric'])
      expect(await names('PERO@EXAMPLE')).toEqual(['Pero Peric'])
      expect(await names(oib.slice(2, 8))).toEqual(['Firma d.o.o.'])
      expect(await names('\\')).toEqual([])
    })

    it('hides archived customers by default and shows them with the toggle', async () => {
      const t = await makeTenant()
      await create(t, person({ name: 'Aktivan' }))
      const gone = await create(t, person({ name: 'Arhiviran' }))
      if (!gone.ok) throw new Error('setup failed')
      await actions.archiveCustomer({ orgSlug: t.slug, customerId: gone.data.customerId })

      const hidden = await queries.listCustomers(t.ctx, {})
      expect(hidden.rows.map((row) => row.name)).toEqual(['Aktivan'])
      expect(hidden.total).toBe(1)

      const shown = await queries.listCustomers(t.ctx, { archived: true })
      expect(shown.rows.map((row) => [row.name, row.archived])).toEqual([
        ['Aktivan', false],
        ['Arhiviran', true],
      ])
    })

    it("only returns the organization's own customers, ordered by lower(name), 50 per page", async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      await create(b, person({ name: 'Tuđi kupac' }))
      for (let i = 0; i < 51; i++) {
        await create(a, person({ name: `kupac ${String(i).padStart(2, '0')}` }))
      }
      await create(a, person({ name: 'Zora' }))
      await create(a, person({ name: 'Ana' }))

      const first = await queries.listCustomers(a.ctx, { page: 1 })
      expect(first.total).toBe(53)
      expect(first.rows).toHaveLength(50)
      expect(first.rows[0]?.name).toBe('Ana')
      const second = await queries.listCustomers(a.ctx, { page: 2 })
      expect(second.rows.map((row) => row.name)).toEqual(['kupac 49', 'kupac 50', 'Zora'])
      expect(first.rows.some((row) => row.name === 'Tuđi kupac')).toBe(false)
    })
  })

  describe('edge cases', () => {
    const missingId = '00000000-0000-4000-8000-000000000000'
    const ALL_FIELDS = [
      'city',
      'countryCode',
      'email',
      'kind',
      'name',
      'note',
      'oib',
      'postalCode',
      'street',
      'vatId',
    ]

    it('lets only one of two concurrent creations with the same OIB win', async () => {
      const t = await makeTenant()
      const oib = fakeOib(rng)
      const results = await Promise.all([
        create(t, business(oib, { name: 'Prvi d.o.o.' })),
        create(t, business(oib, { name: 'Drugi d.o.o.' })),
      ])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      const failed = results.find((r) => !r.ok)
      if (failed && !failed.ok) {
        expect(failed.fieldErrors?.oib).toBe('Kupac s tim OIB-om već postoji.')
      }
      expect((await audit(t)).map((row) => row.action)).toEqual(['customer.created'])
    })

    it('ignores organizationId, archivedAt and id posted in the input', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      const result = await create(
        a,
        person({ organizationId: b.orgId, archivedAt: '2020-01-01', id: missingId }),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.customerId).not.toBe(missingId)
      const row = await rowOf(a, result.data.customerId)
      expect(row?.organization_id).toBe(a.orgId)
      expect(row?.archived_at).toBeNull()
      expect((await queries.listCustomers(b.ctx, {})).total).toBe(0)
    })

    it('records every field name on creation and none of the values', async () => {
      const t = await makeTenant()
      await create(t, person({ name: 'Tajno Ime', email: 'tajna@example.test' }))
      const [row] = await audit(t)
      expect([...(row?.changed_fields ?? [])].sort()).toEqual(ALL_FIELDS)
      expect(JSON.stringify(row)).not.toContain('Tajno')
      expect(JSON.stringify(row)).not.toContain('tajna@')
    })

    it('updates a customer keeping its own OIB (no self-clash) and audits the changed name', async () => {
      const t = await makeTenant()
      const oib = fakeOib(rng)
      const created = await create(t, business(oib))
      if (!created.ok) throw new Error('setup failed')
      const result = await actions.updateCustomer({
        orgSlug: t.slug,
        customerId: created.data.customerId,
        ...business(oib, { name: 'Preimenovano d.o.o.' }),
      })
      expect(result.ok).toBe(true)
      expect((await audit(t)).at(-1)?.changed_fields).toEqual(['name'])
      expect((await rowOf(t, created.data.customerId))?.name).toBe('Preimenovano d.o.o.')
    })

    it('allows changing an OIB to one that only an archived customer has', async () => {
      const t = await makeTenant()
      const oibA = fakeOib(rng)
      const oibB = fakeOib(rng)
      const a = await create(t, business(oibA))
      const b = await create(t, business(oibB, { name: 'B d.o.o.' }))
      if (!a.ok || !b.ok) throw new Error('setup failed')
      await actions.archiveCustomer({ orgSlug: t.slug, customerId: a.data.customerId })
      const result = await actions.updateCustomer({
        orgSlug: t.slug,
        customerId: b.data.customerId,
        ...business(oibA, { name: 'B d.o.o.' }),
      })
      expect(result.ok).toBe(true)
    })

    it('rejects an invalid update payload with field errors and no audit row', async () => {
      const t = await makeTenant()
      const created = await create(t, person())
      if (!created.ok) throw new Error('setup failed')
      const result = await actions.updateCustomer({
        orgSlug: t.slug,
        customerId: created.data.customerId,
        ...person({ name: '' }),
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.fieldErrors?.name).toBe('Obavezno polje.')
      expect((await audit(t)).map((row) => row.action)).toEqual(['customer.created'])
    })

    it('returns a failure for a well-formed id that does not exist', async () => {
      const t = await makeTenant()
      const results = [
        await actions.archiveCustomer({ orgSlug: t.slug, customerId: missingId }),
        await actions.restoreCustomer({ orgSlug: t.slug, customerId: missingId }),
        await actions.updateCustomer({ orgSlug: t.slug, customerId: missingId, ...person() }),
      ]
      for (const result of results) {
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.message).toBe('Kupac ne postoji.')
      }
      expect(await audit(t)).toEqual([])
    })

    it('treats a missing customerId as not found', async () => {
      const t = await makeTenant()
      expect((await actions.archiveCustomer({ orgSlug: t.slug })).ok).toBe(false)
      expect((await actions.updateCustomer({ orgSlug: t.slug, ...person() })).ok).toBe(false)
    })

    it('restores an archived customer when its OIB is free, and a second restore is a no-op', async () => {
      const t = await makeTenant()
      const created = await create(t, business(fakeOib(rng)))
      if (!created.ok) throw new Error('setup failed')
      const id = created.data.customerId
      await actions.archiveCustomer({ orgSlug: t.slug, customerId: id })
      expect((await actions.restoreCustomer({ orgSlug: t.slug, customerId: id })).ok).toBe(true)
      expect((await rowOf(t, id))?.archived_at).toBeNull()
      await actions.restoreCustomer({ orgSlug: t.slug, customerId: id })
      expect((await audit(t)).map((r) => r.action)).toEqual([
        'customer.created',
        'customer.archived',
        'customer.restored',
      ])
    })

    it('lets an accountant and a member edit and archive', async () => {
      for (const role of ['accountant', 'member'] as const) {
        const t = await makeTenant(role)
        const created = await create(t, person())
        if (!created.ok) throw new Error('setup failed')
        const id = created.data.customerId
        const update = await actions.updateCustomer({
          orgSlug: t.slug,
          customerId: id,
          ...person({ name: 'Novo' }),
        })
        expect(update.ok).toBe(true)
        expect((await actions.archiveCustomer({ orgSlug: t.slug, customerId: id })).ok).toBe(true)
      }
    })

    it('stores SQL-looking and markup text literally', async () => {
      const t = await makeTenant()
      const name = "Robert'); DROP TABLE customers;-- <b>x</b>"
      const created = await create(t, person({ name }))
      expect(created.ok).toBe(true)
      if (!created.ok) return
      expect((await rowOf(t, created.data.customerId))?.name).toBe(name)
    })
  })

  describe('listCustomers edge cases', () => {
    it('returns an empty list for an organization without customers', async () => {
      const t = await makeTenant()
      expect(await queries.listCustomers(t.ctx, {})).toMatchObject({ rows: [], total: 0, page: 1 })
    })

    it('treats a blank search as no filter', async () => {
      const t = await makeTenant()
      await create(t, person({ name: 'Ana' }))
      expect((await queries.listCustomers(t.ctx, { q: '   ' })).total).toBe(1)
    })

    it('falls back to page 1 for invalid page numbers and returns no rows past the end', async () => {
      const t = await makeTenant()
      await create(t, person({ name: 'Ana' }))
      for (const page of [0, -3, 1.5, Number.NaN]) {
        expect((await queries.listCustomers(t.ctx, { page })).page).toBe(1)
      }
      const past = await queries.listCustomers(t.ctx, { page: 9 })
      expect(past.rows).toEqual([])
      expect(past.total).toBe(1)
    })

    it('searches case-insensitively with diacritics and stays inside the organization', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      await create(a, person({ name: 'Čačić Željko' }))
      await create(b, person({ name: 'Čačić Tuđi' }))
      const rows = (await queries.listCustomers(a.ctx, { q: 'čAČIĆ' })).rows.map((r) => r.name)
      expect(rows).toEqual(['Čačić Željko'])
    })

    it('does not treat quotes or SQL fragments in the search as syntax', async () => {
      const t = await makeTenant()
      await create(t, person({ name: 'Ana' }))
      expect((await queries.listCustomers(t.ctx, { q: "' OR 1=1 --" })).rows).toEqual([])
    })

    it('shows archived duplicates with active ones only when the toggle is on', async () => {
      const t = await makeTenant()
      const oib = fakeOib(rng)
      const old = await create(t, business(oib, { name: 'Stari d.o.o.' }))
      if (!old.ok) throw new Error('setup failed')
      await actions.archiveCustomer({ orgSlug: t.slug, customerId: old.data.customerId })
      await create(t, business(oib, { name: 'Novi d.o.o.' }))
      const hidden = await queries.listCustomers(t.ctx, {})
      expect(hidden.rows.map((r) => r.name)).toEqual(['Novi d.o.o.'])
      expect((await queries.listCustomers(t.ctx, { archived: true })).total).toBe(2)
    })
  })

  describe('escapeLike', () => {
    it('escapes backslash, percent and underscore only', () => {
      expect(queries.escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
      expect(queries.escapeLike('plain')).toBe('plain')
    })
  })
})
