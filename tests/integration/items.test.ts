import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { addMember, appPool, asTenant, createOrg, createUser, ownerPool } from '../helpers/db'
import { testOrgContext } from '../helpers/org-context'
import type { OrgContext } from '@/server/auth/context'

// The item actions and queries against the real database (RLS, CHECK constraints, audit trigger).
// Same harness as customers.test.ts: requireOrgContext is replaced by a lookup in a map of
// pre-minted contexts; a slug that is not in the map behaves like a non-member (notFound).

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

describe('items', () => {
  const owner = ownerPool()
  const app = appPool()

  let actions: typeof import('@/server/items/actions')
  let queries: typeof import('@/server/items/queries')
  let client: typeof import('@/server/db/client')

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    process.env.BETTER_AUTH_SECRET = randomBytes(24).toString('hex')
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.SMTP_HOST = 'localhost'
    process.env.MAIL_FROM = 'test@example.test'
    actions = await import('@/server/items/actions')
    queries = await import('@/server/items/queries')
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

  const item = (overrides: Record<string, unknown> = {}) => ({
    name: 'Izrada web stranice',
    unitCode: 'HUR',
    unitPrice: '50,00',
    ...overrides,
  })

  async function create(t: Tenant, fields: Record<string, unknown>) {
    return actions.createItem({ orgSlug: t.slug, ...fields })
  }

  async function rowOf(t: Tenant, id: string) {
    return asTenant(app, t.orgId, async (c) => {
      const { rows } = await c.query(`select * from items where id = $1`, [id])
      return rows[0] as Record<string, unknown> | undefined
    })
  }

  async function countOf(t: Tenant) {
    return asTenant(app, t.orgId, async (c) => {
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from items`)
      return Number(rows[0]?.n)
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

  it('stores "0,125" as numeric 0.125000 and reads it back as a decimal string', async () => {
    const t = await makeTenant()
    const result = await create(t, item({ unitPrice: '0,125' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = await rowOf(t, result.data.itemId)
    expect(row?.unit_price).toBe('0.125000')
    expect(row?.currency).toBe('EUR')
    expect(row?.organization_id).toBe(t.orgId)
    const read = await queries.getItem(t.ctx, result.data.itemId)
    expect(read.unitPrice).toBe('0.125000')
  })

  it('accepts a grouped price and the maximum, and normalizes the KPD code', async () => {
    const t = await makeTenant()
    const grouped = await create(t, item({ unitPrice: '1.234,50', kpdCode: ' 62.01.11 ' }))
    if (!grouped.ok) throw new Error('setup failed')
    const row = await rowOf(t, grouped.data.itemId)
    expect(row?.unit_price).toBe('1234.500000')
    expect(row?.kpd_code).toBe('620111')

    const max = await create(t, item({ unitPrice: '999.999.999,999999' }))
    expect(max.ok).toBe(true)
    const tooBig = await create(t, item({ unitPrice: '1.000.000.000' }))
    expect(tooBig.ok).toBe(false)
  })

  it('rejects "1.234" with the ambiguity message and stores nothing', async () => {
    const t = await makeTenant()
    const result = await create(t, item({ unitPrice: '1.234' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fieldErrors?.unitPrice).toMatch(/^Nejasan iznos/)
    expect(await countOf(t)).toBe(0)
    expect(await audit(t)).toEqual([])
  })

  it('rejects a negative price, 7 decimals, a bad unit, a bad KPD and a foreign currency', async () => {
    const t = await makeTenant()
    const cases: [Record<string, unknown>, string][] = [
      [{ unitPrice: '-1' }, 'unitPrice'],
      [{ unitPrice: '0,1234567' }, 'unitPrice'],
      [{ unitPrice: '' }, 'unitPrice'],
      [{ unitPrice: 12 }, 'unitPrice'],
      [{ unitCode: 'XXX' }, 'unitCode'],
      [{ kpdCode: '6201' }, 'kpdCode'],
      [{ currency: 'USD' }, 'currency'],
      [{ name: '   ' }, 'name'],
      [{ name: 'Naziv\nu dva reda' }, 'name'],
      [{ description: 'Tab\there' }, 'description'],
    ]
    for (const [overrides, field] of cases) {
      const result = await create(t, item(overrides))
      expect(result.ok, field).toBe(false)
      if (!result.ok) expect(result.fieldErrors?.[field], field).toBeTruthy()
    }
    expect(await countOf(t)).toBe(0)
  })

  it('allows line breaks in the description and a free price of zero', async () => {
    const t = await makeTenant()
    const result = await create(t, item({ unitPrice: '0', description: 'Prvi red\nDrugi red' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = await rowOf(t, result.data.itemId)
    expect(row?.unit_price).toBe('0.000000')
    expect(row?.description).toBe('Prvi red\nDrugi red')
  })

  it('audits field names only, and an unchanged price in another notation is no change', async () => {
    const t = await makeTenant()
    const created = await create(t, item({ unitPrice: '0,125', description: 'Tajni opis' }))
    if (!created.ok) throw new Error('setup failed')
    const id = created.data.itemId
    const base = { orgSlug: t.slug, itemId: id, ...item({ description: 'Tajni opis' }) }
    // 0,125 -> same value typed as 0.1250 (not "ambiguous": leading 0.) -> no change
    expect((await actions.updateItem({ ...base, unitPrice: '0.1250' })).ok).toBe(true)
    // price and KPD change
    expect((await actions.updateItem({ ...base, unitPrice: '0,25', kpdCode: '62.01.11' })).ok).toBe(
      true,
    )
    await actions.archiveItem({ orgSlug: t.slug, itemId: id })
    await actions.archiveItem({ orgSlug: t.slug, itemId: id })
    await actions.restoreItem({ orgSlug: t.slug, itemId: id })

    const rows = await audit(t)
    expect(rows.map((row) => row.action)).toEqual([
      'item.created',
      'item.updated',
      'item.archived',
      'item.restored',
    ])
    expect(rows[1]?.changed_fields.sort()).toEqual(['kpdCode', 'unitPrice'])
    expect(rows.every((row) => row.entity_type === 'item' && row.entity_id === id)).toBe(true)
    const dump = JSON.stringify(rows)
    for (const value of ['Tajni opis', 'web stranice', '0.25', '620111']) {
      expect(dump).not.toContain(value)
    }
  })

  it('refuses editing an archived item', async () => {
    const t = await makeTenant()
    const created = await create(t, item())
    if (!created.ok) throw new Error('setup failed')
    const id = created.data.itemId
    await actions.archiveItem({ orgSlug: t.slug, itemId: id })
    const result = await actions.updateItem({
      orgSlug: t.slug,
      itemId: id,
      ...item({ name: 'Promijenjeno' }),
    })
    expect(result.ok).toBe(false)
    expect((await rowOf(t, id))?.name).toBe('Izrada web stranice')
  })

  it('treats another organization as not found and changes nothing there', async () => {
    const a = await makeTenant()
    const created = await create(a, item())
    if (!created.ok) throw new Error('setup failed')
    const id = created.data.itemId

    const strangerSlug = `test-${randomBytes(6).toString('hex')}`
    await expect(actions.archiveItem({ orgSlug: strangerSlug, itemId: id })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
    await expect(
      actions.updateItem({ orgSlug: strangerSlug, itemId: id, ...item() }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(create({ ...a, slug: strangerSlug }, item())).rejects.toThrow('NEXT_NOT_FOUND')
    expect((await rowOf(a, id))?.archived_at).toBeNull()

    // A member of another organization using the id of A's item: the row is invisible.
    const b = await makeTenant()
    const result = await actions.archiveItem({ orgSlug: b.slug, itemId: id })
    expect(result.ok).toBe(false)
    const update = await actions.updateItem({ orgSlug: b.slug, itemId: id, ...item() })
    expect(update.ok).toBe(false)
    expect((await rowOf(a, id))?.archived_at).toBeNull()
    await expect(queries.getItem(b.ctx, id)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(queries.getItem(a.ctx, id)).resolves.toMatchObject({ id })
  })

  it('lets every role create items, and rejects a malformed id', async () => {
    for (const role of ['accountant', 'member'] as const) {
      const t = await makeTenant(role)
      expect((await create(t, item())).ok).toBe(true)
    }
    const t = await makeTenant()
    expect((await actions.archiveItem({ orgSlug: t.slug, itemId: 'nope' })).ok).toBe(false)
    await expect(queries.getItem(t.ctx, 'nope')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  describe('listItems and searchItems', () => {
    it('escapes % and _ and matches name, description and KPD', async () => {
      const t = await makeTenant()
      await create(t, item({ name: 'Popust 50% paket' }))
      await create(t, item({ name: 'Popust 500 paket' }))
      await create(t, item({ name: 'Naziv_jedan' }))
      await create(t, item({ name: 'Savjetovanje', description: 'Mjesečni izvještaj' }))
      await create(t, item({ name: 'Razvoj', kpdCode: '62.01.11' }))

      const names = async (q: string) =>
        (await queries.listItems(t.ctx, { q })).rows.map((row) => row.name)
      expect(await names('50%')).toEqual(['Popust 50% paket'])
      expect(await names('%')).toEqual(['Popust 50% paket'])
      expect(await names('Naziv_')).toEqual(['Naziv_jedan'])
      expect(await names('_')).toEqual(['Naziv_jedan'])
      expect(await names('IZVJEŠTAJ')).toEqual(['Savjetovanje'])
      expect(await names('620111')).toEqual(['Razvoj'])
      expect(await names('\\')).toEqual([])
      expect(await names('62.01.11')).toEqual(['Razvoj'])
      expect(await names('62.01')).toEqual(['Razvoj'])
      expect(await names(' 62 01 ')).toEqual(['Razvoj'])
      expect(await names('63.01')).toEqual([])
    })

    it('hides archived items by default, shows them with the toggle, is org-scoped and ordered', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      await create(b, item({ name: 'Tuđi artikl' }))
      await create(a, item({ name: 'zeta' }))
      await create(a, item({ name: 'Alfa' }))
      const gone = await create(a, item({ name: 'Arhiviran' }))
      if (!gone.ok) throw new Error('setup failed')
      await actions.archiveItem({ orgSlug: a.slug, itemId: gone.data.itemId })

      const hidden = await queries.listItems(a.ctx, {})
      expect(hidden.rows.map((row) => row.name)).toEqual(['Alfa', 'zeta'])
      expect(hidden.total).toBe(2)
      const shown = await queries.listItems(a.ctx, { archived: true })
      expect(shown.rows.map((row) => [row.name, row.archived])).toEqual([
        ['Alfa', false],
        ['Arhiviran', true],
        ['zeta', false],
      ])
      expect(shown.rows.find((row) => row.name === 'Alfa')?.unitPrice).toBe('50.000000')
    })

    it('paginates 50 per page and searchItems is scoped to the caller', async () => {
      const a = await makeTenant('member')
      for (let i = 0; i < 51; i++) {
        await create(a, item({ name: `artikl ${String(i).padStart(2, '0')}` }))
      }
      const first = await queries.listItems(a.ctx, { page: 1 })
      expect(first.total).toBe(51)
      expect(first.rows).toHaveLength(50)
      const second = await queries.listItems(a.ctx, { page: 2 })
      expect(second.rows.map((row) => row.name)).toEqual(['artikl 50'])

      const found = await actions.searchItems({ orgSlug: a.slug, q: 'ARTIKL 07' })
      expect(found.ok && found.data.rows.map((row) => row.name)).toEqual(['artikl 07'])
      await expect(actions.searchItems({ orgSlug: 'not-a-member', q: 'a' })).rejects.toThrow(
        'NEXT_NOT_FOUND',
      )
    })
  })

  it('has no DELETE grant: items can only be archived', async () => {
    const t = await makeTenant()
    const created = await create(t, item())
    if (!created.ok) throw new Error('setup failed')
    await expect(
      asTenant(app, t.orgId, (c) =>
        c.query(`delete from items where id = $1`, [created.data.itemId]),
      ),
    ).rejects.toThrow()
  })
})
