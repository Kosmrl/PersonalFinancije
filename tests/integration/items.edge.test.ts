import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { addMember, appPool, asTenant, createOrg, createUser, ownerPool } from '../helpers/db'
import { testOrgContext } from '../helpers/org-context'
import type { OrgContext } from '@/server/auth/context'

// Edge cases for the item actions against the real database: concurrency, archive/restore
// lifecycle, tenancy at the SQL level, and stored precision. Same harness as items.test.ts.

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

describe('items edge cases', () => {
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

  async function create(t: Tenant, fields: Record<string, unknown> = {}) {
    const result = await actions.createItem({ orgSlug: t.slug, ...item(fields) })
    if (!result.ok) throw new Error(`setup failed: ${result.message}`)
    return result.data.itemId
  }

  async function rowOf(t: Tenant, id: string) {
    return asTenant(app, t.orgId, async (c) => {
      const { rows } = await c.query(`select * from items where id = $1`, [id])
      return rows[0] as Record<string, unknown> | undefined
    })
  }

  async function auditActions(t: Tenant) {
    return asTenant(app, t.orgId, async (c) => {
      const { rows } = await c.query<{ action: string }>(
        `select action from audit_log where organization_id = $1 order by id`,
        [t.orgId],
      )
      return rows.map((row) => row.action)
    })
  }

  describe('stored precision', () => {
    it.each([
      ['1,234', '1.234000'],
      ['0,1250', '0.125000'],
      ['0,000001', '0.000001'],
      ['999.999.999,999999', '999999999.999999'],
      ['1.234.567,891234', '1234567.891234'],
      ['0', '0.000000'],
      ['0,1', '0.100000'],
    ])('stores %j as numeric %s exactly', async (input, stored) => {
      const t = await makeTenant()
      const id = await create(t, { unitPrice: input })
      expect((await rowOf(t, id))?.unit_price).toBe(stored)
    })

    it('rejects out-of-range prices without touching the database', async () => {
      const t = await makeTenant()
      for (const unitPrice of ['1.234', '-5', '-0', '0,1234567', '1000000000', '1e3', 'abc', '']) {
        const result = await actions.createItem({ orgSlug: t.slug, ...item({ unitPrice }) })
        expect(result.ok, unitPrice).toBe(false)
      }
      expect(await auditActions(t)).toEqual([])
    })

    it('rejects a price update to an invalid value and leaves the stored price alone', async () => {
      const t = await makeTenant()
      const id = await create(t, { unitPrice: '12,50' })
      for (const unitPrice of ['1.234', '-1', '0,1234567']) {
        const result = await actions.updateItem({
          orgSlug: t.slug,
          itemId: id,
          ...item({ unitPrice }),
        })
        expect(result.ok, unitPrice).toBe(false)
      }
      expect((await rowOf(t, id))?.unit_price).toBe('12.500000')
      expect(await auditActions(t)).toEqual(['item.created'])
    })

    it('a price edited to the same value in a different notation is no change', async () => {
      const t = await makeTenant()
      const id = await create(t, { unitPrice: '1.234,50' })
      const before = await rowOf(t, id)
      for (const unitPrice of ['1234,5', '1234.50', '1.234,500']) {
        const result = await actions.updateItem({
          orgSlug: t.slug,
          itemId: id,
          ...item({ unitPrice }),
        })
        expect(result.ok, unitPrice).toBe(true)
      }
      expect((await rowOf(t, id))?.updated_at).toEqual(before?.updated_at)
      expect(await auditActions(t)).toEqual(['item.created'])
    })
  })

  describe('KPD', () => {
    it('stores null when empty, clears a KPD on update, and rejects malformed ones', async () => {
      const t = await makeTenant()
      const id = await create(t, { kpdCode: '62.01.11' })
      expect((await rowOf(t, id))?.kpd_code).toBe('620111')
      const cleared = await actions.updateItem({
        orgSlug: t.slug,
        itemId: id,
        ...item({ kpdCode: '' }),
      })
      expect(cleared.ok).toBe(true)
      expect((await rowOf(t, id))?.kpd_code).toBeNull()
      for (const kpdCode of ['6201111', '62.01', 'abc', '62.01.1a']) {
        const result = await actions.updateItem({
          orgSlug: t.slug,
          itemId: id,
          ...item({ kpdCode }),
        })
        expect(result.ok, kpdCode).toBe(false)
      }
      expect((await rowOf(t, id))?.kpd_code).toBeNull()
    })

    it('keeps leading zeros in a stored KPD code', async () => {
      const t = await makeTenant()
      const id = await create(t, { kpdCode: '01.11.11' })
      expect((await rowOf(t, id))?.kpd_code).toBe('011111')
    })
  })

  describe('archive and restore', () => {
    it('round trips: archived hides from the default list, restore brings it back, editable again', async () => {
      const t = await makeTenant()
      const id = await create(t, { name: 'Vracanje' })
      expect((await actions.archiveItem({ orgSlug: t.slug, itemId: id })).ok).toBe(true)
      const archivedRow = await rowOf(t, id)
      expect(archivedRow?.archived_at).toBeInstanceOf(Date)
      expect((await queries.listItems(t.ctx, {})).rows).toHaveLength(0)

      expect((await actions.restoreItem({ orgSlug: t.slug, itemId: id })).ok).toBe(true)
      expect((await rowOf(t, id))?.archived_at).toBeNull()
      expect((await queries.listItems(t.ctx, {})).rows.map((r) => r.name)).toEqual(['Vracanje'])

      const edit = await actions.updateItem({
        orgSlug: t.slug,
        itemId: id,
        ...item({ name: 'Novo' }),
      })
      expect(edit.ok).toBe(true)
      expect((await rowOf(t, id))?.name).toBe('Novo')
    })

    it('restoring an active item and archiving twice are idempotent and audit once', async () => {
      const t = await makeTenant()
      const id = await create(t)
      expect((await actions.restoreItem({ orgSlug: t.slug, itemId: id })).ok).toBe(true)
      expect((await actions.archiveItem({ orgSlug: t.slug, itemId: id })).ok).toBe(true)
      const firstArchivedAt = (await rowOf(t, id))?.archived_at
      expect((await actions.archiveItem({ orgSlug: t.slug, itemId: id })).ok).toBe(true)
      expect((await rowOf(t, id))?.archived_at).toEqual(firstArchivedAt)
      expect(await auditActions(t)).toEqual(['item.created', 'item.archived'])
    })

    it('an archived item stays searchable with the toggle and keeps its data intact', async () => {
      const t = await makeTenant()
      const id = await create(t, { name: 'Stari artikl', unitPrice: '0,125', kpdCode: '62.01.11' })
      await actions.archiveItem({ orgSlug: t.slug, itemId: id })
      const hidden = await actions.searchItems({ orgSlug: t.slug, q: 'Stari' })
      expect(hidden.ok && hidden.data.rows).toHaveLength(0)
      const shown = await actions.searchItems({ orgSlug: t.slug, q: 'Stari', archived: true })
      expect(shown.ok && shown.data.rows[0]).toMatchObject({
        unitPrice: '0.125000',
        kpdCode: '620111',
        archived: true,
      })
      expect((await queries.getItem(t.ctx, id)).archivedAt).toBeInstanceOf(Date)
    })

    it('does not change the row on a refused edit of an archived item (no audit row)', async () => {
      const t = await makeTenant()
      const id = await create(t)
      await actions.archiveItem({ orgSlug: t.slug, itemId: id })
      const before = await rowOf(t, id)
      const result = await actions.updateItem({
        orgSlug: t.slug,
        itemId: id,
        ...item({ unitPrice: '99' }),
      })
      expect(result.ok).toBe(false)
      expect(await rowOf(t, id)).toEqual(before)
      expect(await auditActions(t)).toEqual(['item.created', 'item.archived'])
    })
  })

  describe('concurrency', () => {
    it('parallel archives and restores of one item end consistent with one audit row per transition', async () => {
      const t = await makeTenant()
      const id = await create(t)
      const results = await Promise.all(
        Array.from({ length: 10 }, () => actions.archiveItem({ orgSlug: t.slug, itemId: id })),
      )
      expect(results.every((r) => r.ok)).toBe(true)
      expect((await rowOf(t, id))?.archived_at).not.toBeNull()
      expect((await auditActions(t)).filter((a) => a === 'item.archived')).toHaveLength(1)

      const restores = await Promise.all(
        Array.from({ length: 10 }, () => actions.restoreItem({ orgSlug: t.slug, itemId: id })),
      )
      expect(restores.every((r) => r.ok)).toBe(true)
      expect((await rowOf(t, id))?.archived_at).toBeNull()
      expect((await auditActions(t)).filter((a) => a === 'item.restored')).toHaveLength(1)
    })

    it('concurrent identical updates do not lose or double-audit the change', async () => {
      const t = await makeTenant()
      const id = await create(t)
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          actions.updateItem({ orgSlug: t.slug, itemId: id, ...item({ unitPrice: '75' }) }),
        ),
      )
      expect(results.every((r) => r.ok)).toBe(true)
      expect((await rowOf(t, id))?.unit_price).toBe('75.000000')
      expect((await auditActions(t)).filter((a) => a === 'item.updated')).toHaveLength(1)
    })

    it('concurrent different updates leave one complete winner, never a mix', async () => {
      const t = await makeTenant()
      const id = await create(t)
      const variants = [
        { name: 'A', unitPrice: '1', unitCode: 'HUR' },
        { name: 'B', unitPrice: '2', unitCode: 'DAY' },
        { name: 'C', unitPrice: '3', unitCode: 'KGM' },
      ]
      await Promise.all(
        variants.map((v) => actions.updateItem({ orgSlug: t.slug, itemId: id, ...item(v) })),
      )
      const row = await rowOf(t, id)
      const winner = variants.find((v) => v.name === row?.name)
      expect(winner).toBeDefined()
      expect(Number(row?.unit_price)).toBe(Number(winner?.unitPrice))
      expect(row?.unit_code).toBe(winner?.unitCode)
    })

    it('an update racing an archive either applies before it or is refused, never edits an archived row', async () => {
      const t = await makeTenant()
      const id = await create(t)
      const [edit, archive] = await Promise.all([
        actions.updateItem({ orgSlug: t.slug, itemId: id, ...item({ name: 'Utrka' }) }),
        actions.archiveItem({ orgSlug: t.slug, itemId: id }),
      ])
      expect(archive.ok).toBe(true)
      const row = await rowOf(t, id)
      expect(row?.archived_at).not.toBeNull()
      // name changed only if the edit reported success
      expect(row?.name === 'Utrka').toBe(edit.ok)
    })

    it('parallel creates all succeed with distinct ids', async () => {
      const t = await makeTenant()
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          actions.createItem({ orgSlug: t.slug, ...item({ name: `Paralelni ${i}` }) }),
        ),
      )
      expect(results.every((r) => r.ok)).toBe(true)
      const ids = new Set(results.map((r) => (r.ok ? r.data.itemId : '')))
      expect(ids.size).toBe(20)
      expect((await queries.listItems(t.ctx, {})).total).toBe(20)
    })

    it('allows duplicate names (items are not unique by name)', async () => {
      const t = await makeTenant()
      await create(t, { name: 'Isto' })
      await create(t, { name: 'Isto' })
      expect((await queries.listItems(t.ctx, { q: 'Isto' })).total).toBe(2)
    })
  })

  describe('tenancy', () => {
    it('organization B cannot read, update, archive or restore A items, even by raw SQL', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      const id = await create(a, { name: 'Tajni artikl' })
      await actions.archiveItem({ orgSlug: a.slug, itemId: id })

      expect((await actions.restoreItem({ orgSlug: b.slug, itemId: id })).ok).toBe(false)
      expect((await rowOf(a, id))?.archived_at).not.toBeNull()
      expect(await rowOf(b, id)).toBeUndefined()

      const updated = await asTenant(app, b.orgId, (c) =>
        c.query(`update items set name = 'Hakirano' where id = $1`, [id]),
      )
      expect(updated.rowCount).toBe(0)
      expect((await rowOf(a, id))?.name).toBe('Tajni artikl')
      expect((await auditActions(b)).length).toBe(0)
    })

    it('RLS refuses inserting an item into another organization', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      await expect(
        asTenant(app, a.orgId, (c) =>
          c.query(
            `insert into items (organization_id, name, unit_code, unit_price) values ($1, 'x', 'HUR', 1)`,
            [b.orgId],
          ),
        ),
      ).rejects.toThrow()
    })

    it('RLS refuses moving an item to another organization', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      const id = await create(a)
      await expect(
        asTenant(app, a.orgId, (c) =>
          c.query(`update items set organization_id = $2 where id = $1`, [id, b.orgId]),
        ),
      ).rejects.toThrow()
      expect((await rowOf(a, id))?.organization_id).toBe(a.orgId)
    })

    it('lists and searches only the caller organization with the same names in both', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      await create(a, { name: 'Zajednicki' })
      await create(b, { name: 'Zajednicki' })
      await create(b, { name: 'Zajednicki dva' })
      expect((await queries.listItems(a.ctx, { q: 'Zajednicki' })).total).toBe(1)
      const found = await actions.searchItems({ orgSlug: b.slug, q: 'Zajednicki' })
      expect(found.ok && found.data.total).toBe(2)
    })

    it('a stale or hostile orgSlug in the payload cannot redirect a write to another org', async () => {
      const a = await makeTenant()
      const b = await makeTenant()
      const result = await actions.createItem({
        orgSlug: a.slug,
        organizationId: b.orgId,
        ...item({ name: 'Moj' }),
      })
      expect(result.ok).toBe(true)
      expect((await queries.listItems(a.ctx, {})).total).toBe(1)
      expect((await queries.listItems(b.ctx, {})).total).toBe(0)
    })

    it('non-object, null and malformed inputs fail cleanly or as not found', async () => {
      for (const input of [null, undefined, 'x', 5, [], {}]) {
        await expect(actions.createItem(input)).rejects.toThrow('NEXT_NOT_FOUND')
        await expect(actions.archiveItem(input)).rejects.toThrow('NEXT_NOT_FOUND')
      }
    })
  })

  describe('list edge cases', () => {
    it('empty state: a fresh org has no items and total 0', async () => {
      const t = await makeTenant()
      expect(await queries.listItems(t.ctx, {})).toMatchObject({ rows: [], total: 0, page: 1 })
    })

    it('invalid page numbers fall back to page 1; a page past the end is empty', async () => {
      const t = await makeTenant()
      await create(t)
      for (const page of [0, -1, 1.5, Number.NaN]) {
        expect((await queries.listItems(t.ctx, { page })).page, String(page)).toBe(1)
      }
      const far = await queries.listItems(t.ctx, { page: 99 })
      expect(far.rows).toEqual([])
      expect(far.total).toBe(1)
      const viaAction = await actions.searchItems({ orgSlug: t.slug, q: '', page: '2' })
      expect(viaAction.ok && viaAction.data.page).toBe(1)
    })

    it('searches with regex and SQL metacharacters literally', async () => {
      const t = await makeTenant()
      await create(t, { name: "O'Brien (test) [a-z]" })
      for (const q of ["'", "' OR 1=1 --", '(', '[a-z]', '.*', '\\']) {
        const r = await queries.listItems(t.ctx, { q })
        expect(r.total, q).toBe(q === "'" || q === '(' || q === '[a-z]' ? 1 : 0)
      }
    })

    it('trims and caps the search term at 100 characters', async () => {
      const t = await makeTenant()
      await create(t, { name: 'a'.repeat(100) })
      const r = await actions.searchItems({ orgSlug: t.slug, q: `  ${'a'.repeat(150)}  ` })
      expect(r.ok && r.data.total).toBe(1)
    })

    it('orders names case- and diacritic-stably with ties broken by id', async () => {
      const t = await makeTenant()
      for (const name of ['b', 'B', 'a', 'A']) await create(t, { name })
      const names = (await queries.listItems(t.ctx, {})).rows.map((r) => r.name.toLowerCase())
      expect(names).toEqual(['a', 'a', 'b', 'b'])
    })
  })

  describe('database constraints', () => {
    it('rejects direct SQL with a negative price, a malformed currency or KPD', async () => {
      const t = await makeTenant()
      const insert = (price: string, unit: string, kpd: string | null, currency = 'EUR') =>
        asTenant(app, t.orgId, (c) =>
          c.query(
            `insert into items (organization_id, name, unit_code, unit_price, kpd_code, currency)
             values ($1, 'x', $2, $3, $4, $5)`,
            [t.orgId, unit, price, kpd, currency],
          ),
        )
      await expect(insert('-1', 'HUR', null)).rejects.toThrow()
      await expect(insert('1', 'HUR', '6201')).rejects.toThrow()
      await expect(insert('1', 'HUR', null, 'eur')).rejects.toThrow()
      await expect(insert('1', 'HUR', null, 'EU')).rejects.toThrow()
    })
  })
})
