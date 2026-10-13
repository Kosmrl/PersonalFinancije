import 'server-only'
import { sql } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { getDb } from './client'
import type * as schema from './schema'

export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

/**
 * The only way to touch tenant tables (obrt_profiles, customers, items, audit_log): runs `fn` in
 * a transaction with app.org_id set for that transaction only (`set_config(..., true)`), which is
 * what the row-level security policies compare organization_id against. Outside it the runtime
 * role sees no tenant row at all.
 *
 * `ctx` must come from requireOrgContext (membership already verified); never build it from
 * request input. Better Auth tables have no RLS and are read on the plain pool.
 */
export async function withTenant<T>(
  ctx: { orgId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!ctx.orgId) throw new Error('withTenant requires an organization id')
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${ctx.orgId}, true)`)
    return fn(tx)
  })
}
