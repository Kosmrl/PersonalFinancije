import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRng, freshSeed } from '../helpers/fake'
import {
  appPool,
  asTenant,
  createOrg,
  insertAudit,
  insertCustomer,
  insertItem,
  insertProfile,
  ownerPool,
  sqlState,
  type TestOrg,
} from '../helpers/db'

// Plan test item 6: row-level security on the four tenant tables, as the runtime role pf_app.

const RLS_VIOLATION = '42501'
const TABLES = ['obrt_profiles', 'customers', 'items', 'audit_log'] as const

describe('row-level security', () => {
  const owner = ownerPool()
  const app = appPool()
  const rng = createRng(freshSeed())
  let a: TestOrg
  let b: TestOrg
  let customerA: string
  let customerB: string

  beforeAll(async () => {
    a = await createOrg(owner)
    b = await createOrg(owner)
    for (const org of [a, b]) {
      await asTenant(app, org.id, async (c) => {
        await insertProfile(c, org.id, rng)
        await insertItem(c, org.id)
        await insertAudit(c, org.id)
      })
    }
    customerA = await asTenant(app, a.id, (c) => insertCustomer(c, a.id, { name: 'Kupac A' }))
    customerB = await asTenant(app, b.id, (c) => insertCustomer(c, b.id, { name: 'Kupac B' }))
  })
  afterAll(async () => {
    await app.end()
    await owner.end()
  })

  it('all four tenant tables have RLS enabled and forced', async () => {
    const { rows } = await owner.query<{ relname: string; on: boolean; forced: boolean }>(
      `select relname, relrowsecurity as on, relforcerowsecurity as forced
         from pg_class where relname = any($1) and relkind = 'r' order by relname`,
      [[...TABLES]],
    )
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row, row.relname).toMatchObject({ on: true, forced: true })
  })

  it.each(TABLES)('%s returns 0 rows without a tenant context', async (table) => {
    // Not vacuous: the table does hold rows, visible under a context.
    const withContext = await asTenant(app, a.id, (c) => c.query(`select * from ${table}`))
    expect(withContext.rowCount).toBeGreaterThan(0)

    const rows = await asTenant(app, null, (c) => c.query(`select * from ${table}`))
    expect(rows.rowCount).toBe(0)
    // A plain autocommit query (no transaction, setting never touched) behaves the same.
    const plain = await app.query(`select * from ${table}`)
    expect(plain.rowCount).toBe(0)
  })

  it.each(TABLES)('%s: an empty app.org_id matches nothing (N3)', async (table) => {
    const rows = await asTenant(app, '', (c) => c.query(`select * from ${table}`))
    expect(rows.rowCount).toBe(0)
  })

  it('an empty app.org_id cannot write a row whose organization_id is empty (N3)', async () => {
    // audit_log has no foreign key, so a row with organization_id '' is storable in principle;
    // the policy must not treat '' = '' as a match.
    expect(
      await sqlState(
        asTenant(app, '', (c) =>
          c.query(
            `insert into audit_log (organization_id, actor_user_id, action, entity_type, entity_id)
             values ('', 'u', 'customer.created', 'customer', 'c')`,
          ),
        ),
      ),
    ).toBe(RLS_VIOLATION)
  })

  it('the tenant context does not leak to the next transaction on a pooled connection', async () => {
    const single = new pg.Pool({
      connectionString: app.options.connectionString,
      max: 1,
    })
    try {
      await asTenant(single, a.id, async (c) => {
        expect((await c.query('select * from customers')).rowCount).toBe(1)
      })
      const after = await single.query('select * from customers')
      expect(after.rowCount).toBe(0)
    } finally {
      await single.end()
    }
  })

  it.each(TABLES)('%s: org A sees only its own rows, org B only its own', async (table) => {
    const rowsA = await asTenant(app, a.id, (c) =>
      c.query<{ organization_id: string }>(`select organization_id from ${table}`),
    )
    expect(rowsA.rows.length).toBeGreaterThan(0)
    expect(new Set(rowsA.rows.map((r) => r.organization_id))).toEqual(new Set([a.id]))

    const rowsB = await asTenant(app, b.id, (c) =>
      c.query<{ organization_id: string }>(`select organization_id from ${table}`),
    )
    expect(new Set(rowsB.rows.map((r) => r.organization_id))).toEqual(new Set([b.id]))
  })

  it('org A cannot read org B customer by id', async () => {
    const { rowCount } = await asTenant(app, a.id, (c) =>
      c.query('select 1 from customers where id = $1', [customerB]),
    )
    expect(rowCount).toBe(0)
  })

  it('INSERT with organization_id of B under context A fails (all tenant tables)', async () => {
    const attempts: Array<(c: pg.PoolClient) => Promise<unknown>> = [
      (c) => insertProfile(c, b.id, rng),
      (c) => insertCustomer(c, b.id),
      (c) => insertItem(c, b.id),
      (c) => insertAudit(c, b.id),
    ]
    for (const attempt of attempts) {
      expect(await sqlState(asTenant(app, a.id, attempt))).toBe(RLS_VIOLATION)
    }
  })

  it('INSERT without a tenant context fails', async () => {
    expect(await sqlState(asTenant(app, null, (c) => insertCustomer(c, a.id)))).toBe(RLS_VIOLATION)
  })

  it('UPDATE ... SET organization_id = B under context A fails', async () => {
    expect(
      await sqlState(
        asTenant(app, a.id, (c) =>
          c.query('update customers set organization_id = $1 where id = $2', [b.id, customerA]),
        ),
      ),
    ).toBe(RLS_VIOLATION)
    expect(
      await sqlState(
        asTenant(app, a.id, (c) =>
          c.query('update items set organization_id = $1 where organization_id = $2', [b.id, a.id]),
        ),
      ),
    ).toBe(RLS_VIOLATION)
    expect(
      await sqlState(
        asTenant(app, a.id, (c) =>
          c.query('update obrt_profiles set organization_id = $1', [b.id]),
        ),
      ),
    ).toBe(RLS_VIOLATION)
  })

  it("UPDATE of org B's row under context A changes nothing", async () => {
    const result = await asTenant(app, a.id, (c) =>
      c.query(`update customers set name = 'Hijacked' where id = $1`, [customerB]),
    )
    expect(result.rowCount).toBe(0)
    const { rows } = await asTenant(app, b.id, (c) =>
      c.query<{ name: string }>('select name from customers where id = $1', [customerB]),
    )
    expect(rows[0]?.name).toBe('Kupac B')
  })

  it('pf_app has no DELETE grant on the tenant tables, nor UPDATE on audit_log', async () => {
    for (const table of ['obrt_profiles', 'customers', 'items', 'audit_log']) {
      expect(await sqlState(asTenant(app, a.id, (c) => c.query(`delete from ${table}`)))).toBe(
        '42501',
      )
    }
    const { rows } = await owner.query<Record<string, boolean>>(
      `select has_table_privilege('pf_app', 'customers', 'DELETE') as customers_delete,
              has_table_privilege('pf_app', 'items', 'DELETE') as items_delete,
              has_table_privilege('pf_app', 'obrt_profiles', 'DELETE') as profiles_delete,
              has_table_privilege('pf_app', 'audit_log', 'UPDATE') as audit_update,
              has_table_privilege('pf_app', 'audit_log', 'DELETE') as audit_delete,
              has_table_privilege('pf_app', 'audit_log', 'TRUNCATE') as audit_truncate,
              has_table_privilege('pf_app', 'customers', 'TRUNCATE') as customers_truncate`,
    )
    expect(Object.values(rows[0]!).every((v) => v === false)).toBe(true)
  })

  it('pf_owner is subject to FORCE RLS too: no rows without a context', async () => {
    const visible = await asTenant(app, a.id, (c) => c.query('select * from customers'))
    expect(visible.rowCount).toBeGreaterThan(0)
    const { rowCount } = await owner.query('select * from customers')
    expect(rowCount).toBe(0)
  })

  it('pf_app is not the owner of any tenant table and cannot bypass RLS', async () => {
    const { rows } = await owner.query<{ relname: string; owner: string }>(
      `select relname, pg_get_userbyid(relowner) as owner
         from pg_class where relname = any($1) and relkind = 'r'`,
      [[...TABLES]],
    )
    for (const row of rows) expect(row.owner, row.relname).toBe('pf_owner')
  })
})
