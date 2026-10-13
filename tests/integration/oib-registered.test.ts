import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRng, fakeOib, freshSeed } from '../helpers/fake'
import {
  appPool,
  asTenant,
  createOrg,
  insertProfile,
  ownerPool,
  sqlState,
  type TestOrg,
} from '../helpers/db'

// oib_is_registered(text): the SECURITY DEFINER cross-tenant check (plan: "Database roles").

describe('oib_is_registered', () => {
  const owner = ownerPool()
  const app = appPool()
  const rng = createRng(freshSeed())
  let orgA: TestOrg
  let orgB: TestOrg
  let oibOfB: string

  beforeAll(async () => {
    orgA = await createOrg(owner)
    orgB = await createOrg(owner)
    oibOfB = await asTenant(app, orgB.id, (c) => insertProfile(c, orgB.id, rng))
  })
  afterAll(async () => {
    await app.end()
    await owner.end()
  })

  it("sees another organization's OIB under FORCE RLS, while pf_app cannot select the table", async () => {
    // Direct access: org A's context sees no row of B, and without context none at all.
    const direct = await asTenant(app, orgA.id, (c) =>
      c.query('select oib from obrt_profiles where oib = $1', [oibOfB]),
    )
    expect(direct.rowCount).toBe(0)

    // The function answers true from the same context and from none.
    const fromA = await asTenant(app, orgA.id, (c) =>
      c.query<{ taken: boolean }>('select oib_is_registered($1) as taken', [oibOfB]),
    )
    expect(fromA.rows[0]?.taken).toBe(true)
    const noContext = await asTenant(app, null, (c) =>
      c.query<{ taken: boolean }>('select oib_is_registered($1) as taken', [oibOfB]),
    )
    expect(noContext.rows[0]?.taken).toBe(true)
  })

  it('returns false for an unregistered OIB', async () => {
    const { rows } = await app.query<{ taken: boolean }>('select oib_is_registered($1) as taken', [
      fakeOib(rng),
    ])
    expect(rows[0]?.taken).toBe(false)
  })

  it('is owned by pf_definer with the hardening from the plan', async () => {
    const { rows } = await owner.query<{
      owner: string
      secdef: boolean
      config: string[] | null
      acl: string[] | null
    }>(
      `select pg_get_userbyid(proowner) as owner, prosecdef as secdef, proconfig as config,
              array(select grantee::regrole::text || ':' || privilege_type
                      from aclexplode(coalesce(proacl, acldefault('f', proowner)))) as acl
         from pg_proc where proname = 'oib_is_registered'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.owner).toBe('pf_definer')
    expect(rows[0]?.secdef).toBe(true)
    expect(rows[0]?.config).toEqual(['search_path=pg_catalog, pg_temp'])
    const acl = [...(rows[0]?.acl ?? [])].sort()
    expect(acl).toEqual(['pf_app:EXECUTE', 'pf_definer:EXECUTE'])
  })

  it('pf_definer can read only obrt_profiles(oib) and has no CREATE on the schema afterwards', async () => {
    const { rows } = await owner.query<Record<string, boolean>>(
      `select has_column_privilege('pf_definer', 'obrt_profiles', 'oib', 'SELECT') as oib,
              has_column_privilege('pf_definer', 'obrt_profiles', 'iban', 'SELECT') as iban,
              has_column_privilege('pf_definer', 'obrt_profiles', 'trade_name', 'SELECT') as trade_name,
              has_table_privilege('pf_definer', 'obrt_profiles', 'INSERT') as ins,
              has_table_privilege('pf_definer', 'customers', 'SELECT') as customers,
              has_schema_privilege('pf_definer', 'public', 'CREATE') as schema_create`,
    )
    expect(rows[0]).toEqual({
      oib: true,
      iban: false,
      trade_name: false,
      ins: false,
      customers: false,
      schema_create: false,
    })
  })

  it('pf_app cannot replace the function', async () => {
    expect(
      await sqlState(
        app.query(`create or replace function public.oib_is_registered(text) returns boolean
                   language sql as 'select false'`),
      ),
    ).toBeDefined()
  })

  it('is not executable by PUBLIC: a role without a grant is refused', async () => {
    const { rows } = await owner.query<{ public_exec: boolean; app_exec: boolean }>(
      `select has_function_privilege('public', 'public.oib_is_registered(text)', 'EXECUTE') as public_exec,
              has_function_privilege('pf_app', 'public.oib_is_registered(text)', 'EXECUTE') as app_exec`,
    )
    expect(rows[0]).toEqual({ public_exec: false, app_exec: true })
  })
})
