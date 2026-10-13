import 'server-only'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '@/server/env'
import { log } from '@/server/log'
import * as schema from './schema'

// The runtime connection: DATABASE_URL is the pf_app role (NOSUPERUSER NOBYPASSRLS, owns no
// tables), so row-level security applies to every query made through this pool. Never connect
// the app with the pf_owner migration role.
//
// Created lazily and kept on globalThis, so `next dev` hot reloads reuse one pool and
// `next build` does not need DATABASE_URL just to import a module.

export type Database = NodePgDatabase<typeof schema>

const globalForDb = globalThis as unknown as { pfPool?: Pool; pfDb?: Database }

export function getPool(): Pool {
  if (!globalForDb.pfPool) {
    const pool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      // Fail instead of waiting forever for a free client (defence in depth against pool
      // exhaustion; actions never hold a client while waiting for another one).
      connectionTimeoutMillis: 5000,
    })
    // An idle client can error when the server restarts; without a listener Node would crash.
    pool.on('error', (error) => log.error('database pool error', { error }))
    globalForDb.pfPool = pool
  }
  return globalForDb.pfPool
}

export function getDb(): Database {
  globalForDb.pfDb ??= drizzle(getPool(), { schema })
  return globalForDb.pfDb
}
