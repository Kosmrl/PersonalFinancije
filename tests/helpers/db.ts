// Fixtures and connections for the integration project. Everything here is made-up data
// (tests/helpers/fake.ts); nothing is ever deleted: audit_log is append-only, so tests isolate
// themselves by creating fresh organizations with random ids instead of truncating tables.
//
// Two kinds of connection, mirroring production:
//  - owner (pf_owner): create users, organizations and memberships (Better Auth tables have no
//    RLS) and inspect the catalog. Never used to test tenant isolation.
//  - app (pf_app): the runtime role, the code under test. Tenant data goes through asTenant().

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'
import { fakeHrIban, fakeOib, type Rng } from './fake'

export function ownerPool(): pg.Pool {
  return new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 })
}

export function appPool(): pg.Pool {
  return new pg.Pool({ connectionString: inject('databaseUrl'), max: 4 })
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export type TestOrg = { id: string; slug: string }

export async function createUser(owner: pg.Pool): Promise<{ id: string; email: string }> {
  const userId = id('u')
  const email = `${userId}@example.test`
  await owner.query(
    `insert into "user" (id, name, email, email_verified) values ($1, 'Test User', $2, true)`,
    [userId, email],
  )
  return { id: userId, email }
}

export async function createOrg(owner: pg.Pool): Promise<TestOrg> {
  const orgId = id('o')
  const slug = `test-${randomBytes(6).toString('hex')}`
  await owner.query(
    `insert into organization (id, name, slug, created_at) values ($1, 'Test Obrt', $2, now())`,
    [orgId, slug],
  )
  return { id: orgId, slug }
}

export async function addMember(
  owner: pg.Pool,
  orgId: string,
  userId: string,
  role = 'member',
): Promise<string> {
  const memberId = id('m')
  await owner.query(
    `insert into member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [memberId, orgId, userId, role],
  )
  return memberId
}

/**
 * Runs `fn` on one pf_app connection inside a transaction with app.org_id set, like withTenant.
 * Pass `null` for no tenant context at all. Commits when `fn` resolves, rolls back when it throws.
 */
export async function asTenant<T>(
  pool: pg.Pool,
  orgId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (orgId !== null) await client.query(`select set_config('app.org_id', $1, true)`, [orgId])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function insertProfile(
  client: pg.PoolClient,
  orgId: string,
  rng: Rng,
  overrides: { oib?: string } = {},
): Promise<string> {
  const oib = overrides.oib ?? fakeOib(rng)
  await client.query(
    `insert into obrt_profiles
       (organization_id, trade_name, owner_full_name, oib, street, postal_code, city, iban, email,
        default_invoice_note)
     values ($1, 'Test Obrt', 'Test Vlasnik', $2, 'Testna ulica 1', '10000', 'Zagreb', $3,
             'obrt@example.test', 'Test note')`,
    [orgId, oib, fakeHrIban(rng)],
  )
  return oib
}

export async function insertCustomer(
  client: pg.PoolClient,
  orgId: string,
  fields: { kind?: string; name?: string; oib?: string | null; countryCode?: string } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into customers (organization_id, kind, name, oib, country_code)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      orgId,
      fields.kind ?? 'person',
      fields.name ?? 'Test Kupac',
      fields.oib ?? null,
      fields.countryCode ?? 'HR',
    ],
  )
  return rows[0]!.id
}

export async function insertItem(
  client: pg.PoolClient,
  orgId: string,
  fields: { name?: string; unitPrice?: string } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into items (organization_id, name, unit_code, unit_price)
     values ($1, $2, 'H87', $3) returning id`,
    [orgId, fields.name ?? 'Test artikl', fields.unitPrice ?? '1.5'],
  )
  return rows[0]!.id
}

export async function insertAudit(
  client: pg.PoolClient,
  orgId: string,
  actorUserId = 'u_test',
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `insert into audit_log (organization_id, actor_user_id, action, entity_type, entity_id, changed_fields)
     values ($1, $2, 'customer.created', 'customer', 'c1', array['name']) returning id`,
    [orgId, actorUserId],
  )
  return rows[0]!.id
}

/** Postgres error code of a failed query (23514 check, 23505 unique, 42501 privilege, ...). */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    return (error as { code?: string }).code
  }
  return undefined
}
