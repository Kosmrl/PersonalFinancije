import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { applyInitSql, CLUSTER_SUPERUSER } from '../../scripts/db/embedded.ts'

// Smoke test for the local database plumbing (build-sequence step 2): the throwaway PostgreSQL
// started by global-setup.ts accepts connections as the runtime role, and that role cannot
// bypass row-level security.

describe('database roles', () => {
  const client = new pg.Client({ connectionString: inject('databaseUrl') })
  const ownerClient = new pg.Client({ connectionString: inject('ownerDatabaseUrl') })

  beforeAll(async () => {
    await client.connect()
    await ownerClient.connect()
  })
  afterAll(async () => {
    await client.end()
    await ownerClient.end()
  })

  it('connects as pf_app to pf_test and answers a query', async () => {
    const { rows } = await client.query<{ one: number; user: string; db: string }>(
      'select 1 as one, current_user as user, current_database() as db',
    )
    expect(rows[0]).toEqual({ one: 1, user: 'pf_app', db: 'pf_test' })
  })

  it('pf_app is not a superuser and does not have BYPASSRLS', async () => {
    const { rows } = await client.query<{
      rolsuper: boolean
      rolbypassrls: boolean
      rolcreaterole: boolean
      rolcreatedb: boolean
    }>(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
         from pg_roles where rolname = current_user`,
    )
    expect(rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
    ])
  })

  it('pf_app cannot create objects in the public schema (it owns nothing)', async () => {
    const { rows } = await client.query<{ can_create: boolean }>(
      "select has_schema_privilege(current_user, 'public', 'CREATE') as can_create",
    )
    expect(rows[0]?.can_create).toBe(false)
  })

  it('pf_owner owns pf_test and is not a superuser either', async () => {
    const { rows } = await ownerClient.query<{
      current_user: string
      owner: string
      rolsuper: boolean
    }>(
      `select current_user, pg_get_userbyid(d.datdba) as owner, r.rolsuper
         from pg_database d, pg_roles r
        where d.datname = 'pf_test' and r.rolname = current_user`,
    )
    expect(rows[0]).toEqual({ current_user: 'pf_owner', owner: 'pf_owner', rolsuper: false })
  })

  it('pf_definer is a NOLOGIN BYPASSRLS role: pf_owner can SET ROLE to it but does not inherit it; pf_app is not a member', async () => {
    const { rows } = await ownerClient.query<{
      rolcanlogin: boolean
      rolbypassrls: boolean
      rolsuper: boolean
      owner_member: boolean
      owner_inherits: boolean
      owner_can_set: boolean
      app_member: boolean
    }>(
      `select rolcanlogin, rolbypassrls, rolsuper,
              pg_has_role('pf_owner', 'pf_definer', 'member') as owner_member,
              pg_has_role('pf_owner', 'pf_definer', 'usage') as owner_inherits,
              pg_has_role('pf_owner', 'pf_definer', 'set') as owner_can_set,
              pg_has_role('pf_app', 'pf_definer', 'member') as app_member
         from pg_roles where rolname = 'pf_definer'`,
    )
    expect(rows).toEqual([
      {
        rolcanlogin: false,
        rolbypassrls: true,
        rolsuper: false,
        owner_member: true,
        owner_inherits: false,
        owner_can_set: true,
        app_member: false,
      },
    ])
  })

  it('pf_app has CONNECT on pf_test but no CREATE or TEMP on it', async () => {
    const { rows } = await client.query<{ connect: boolean; create: boolean; temp: boolean }>(
      `select has_database_privilege(current_user, current_database(), 'CONNECT') as connect,
              has_database_privilege(current_user, current_database(), 'CREATE') as "create",
              has_database_privilege(current_user, current_database(), 'TEMP') as temp`,
    )
    expect(rows[0]).toEqual({ connect: true, create: false, temp: false })
  })

  it.each(['postgres', 'template1'])('pf_app cannot connect to the %s database', async (name) => {
    const url = new URL(inject('databaseUrl'))
    url.pathname = `/${name}`
    const other = new pg.Client({ connectionString: url.toString() })
    other.on('error', () => {})
    await expect(other.connect()).rejects.toThrow(/permission denied/i)
    await other.end().catch(() => {})
  })

  it('stores and compares Croatian text correctly (UTF-8, ICU collation)', async () => {
    const { rows } = await client.query<{ lower: string; sorted: string[] }>(
      `select lower('ČĆŽŠĐ') as lower,
              array(select s from unnest(array['d','č','c','ć','z','ž']) as s order by s) as sorted`,
    )
    expect(rows[0]?.lower).toBe('čćžšđ')
    expect(rows[0]?.sorted).toEqual(['c', 'č', 'ć', 'd', 'z', 'ž'])
  })

  // Runs last in this file. It briefly gives pf_app extra rights and checks that a re-run of
  // init.sql (what every `npm run db` does) takes them away again.
  it('re-running init.sql repairs stray grants to pf_app and an old pf_definer grant', async () => {
    const admin = inject('clusterAdmin')
    const superuser = new pg.Client({
      host: '127.0.0.1',
      port: admin.port,
      user: CLUSTER_SUPERUSER,
      password: admin.superuserPassword,
      database: 'postgres',
    })
    await superuser.connect()
    try {
      await superuser.query('GRANT pf_definer TO pf_app')
      await superuser.query('GRANT CREATE, TEMPORARY ON DATABASE pf_test TO pf_app')
      await superuser.query('GRANT pf_definer TO pf_owner WITH INHERIT TRUE')
      await superuser.query('ALTER ROLE pf_app BYPASSRLS')

      // Same passwords as the first run: other test files keep connecting with them.
      await applyInitSql(admin, {
        ownerPassword: new URL(inject('ownerDatabaseUrl')).password,
        appPassword: new URL(inject('databaseUrl')).password,
        databases: ['pf_test'],
      })

      const { rows } = await superuser.query<{
        app_member: boolean
        app_create: boolean
        app_temp: boolean
        app_connect: boolean
        app_bypassrls: boolean
        owner_inherits: boolean
        owner_can_set: boolean
      }>(
        `select pg_has_role('pf_app', 'pf_definer', 'member') as app_member,
                has_database_privilege('pf_app', 'pf_test', 'CREATE') as app_create,
                has_database_privilege('pf_app', 'pf_test', 'TEMP') as app_temp,
                has_database_privilege('pf_app', 'pf_test', 'CONNECT') as app_connect,
                (select rolbypassrls from pg_roles where rolname = 'pf_app') as app_bypassrls,
                pg_has_role('pf_owner', 'pf_definer', 'usage') as owner_inherits,
                pg_has_role('pf_owner', 'pf_definer', 'set') as owner_can_set`,
      )
      expect(rows[0]).toEqual({
        app_member: false,
        app_create: false,
        app_temp: false,
        app_connect: true,
        app_bypassrls: false,
        owner_inherits: false,
        owner_can_set: true,
      })

      // The role still logs in with its (re-applied) verifier.
      const again = new pg.Client({ connectionString: inject('databaseUrl') })
      await again.connect()
      await again.end()
    } finally {
      await superuser.end()
    }
  })
})
