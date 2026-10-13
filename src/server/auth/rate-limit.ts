import 'server-only'
import { createHmac, randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { getAuthEnv } from '@/server/env'

// A small database-backed fixed-window limiter for server actions, on Better Auth's own
// `rate_limit` table (the same one its HTTP rate limiting uses), so limits hold across server
// instances. One atomic upsert per hit; no read-modify-write race.
//
// Keys are namespaced (`pf:<scope>:<kind>:<id>`) so they never collide with Better Auth's
// per-IP path keys.

export type RateLimit = { scope: string; max: number; windowSeconds: number }

async function hit(key: string, limit: RateLimit): Promise<boolean> {
  const now = Date.now()
  const windowMs = limit.windowSeconds * 1000
  const rows = await getDb().execute<{ count: number }>(sql`
    insert into rate_limit (id, key, count, last_request)
    values (${randomBytes(16).toString('hex')}, ${key}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limit.last_request < ${now - windowMs} then 1 else rate_limit.count + 1 end,
      last_request = case when rate_limit.last_request < ${now - windowMs} then ${now} else rate_limit.last_request end
    returning count
  `)
  const count = rows.rows[0]?.count ?? 1
  return count <= limit.max
}

/**
 * The client address as seen by the first proxy hop, hashed with the auth secret so the table
 * holds no IP addresses. X-Forwarded-For is client-controlled unless a trusted proxy overwrites
 * it, so this key only ever ADDS a limit; the per-user key is the authoritative one.
 * TODO(deployment): read the address the way Better Auth's advanced.ipAddress settings do.
 */
async function clientKey(): Promise<string> {
  const h = await headers()
  const raw = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  return createHmac('sha256', getAuthEnv().BETTER_AUTH_SECRET)
    .update(raw)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Counts one attempt against the per-user and the per-client limits and returns false when
 * either is exhausted. Both counters are always incremented (no short circuit), so a refused
 * attempt keeps counting.
 */
export async function consumeActionLimit(
  userId: string,
  limits: { user: RateLimit; client: RateLimit },
): Promise<boolean> {
  const byUser = await hit(`pf:${limits.user.scope}:user:${userId}`, limits.user)
  const byClient = await hit(`pf:${limits.client.scope}:client:${await clientKey()}`, limits.client)
  return byUser && byClient
}
