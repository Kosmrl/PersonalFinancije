// Vitest globalSetup for the `integration` project. Self-contained: it starts a throwaway
// PostgreSQL 17 (embedded-postgres, temp directory, free port), applies scripts/db/init.sql,
// runs the Drizzle migrations as pf_owner, hands the connection URLs to the tests, and stops
// and deletes the instance afterwards. Nothing else needs to be running.
//
// Not a src/server module on purpose: those start with `import 'server-only'`, which throws
// outside Next.js. Migrations are applied straight through drizzle-orm's migrator.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import type { TestProject } from 'vitest/node'
import {
  applyInitSql,
  Cluster,
  connectionUrl,
  findFreePort,
  sweepStaleTestClusters,
} from '../../scripts/db/embedded.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    /** pf_test as pf_app (runtime role: NOSUPERUSER NOBYPASSRLS). Use for the code under test. */
    databaseUrl: string
    /** pf_test as pf_owner (schema owner). Use only for fixtures, truncation and migrations. */
    ownerDatabaseUrl: string
    /** The throwaway cluster's superuser, for tests of the bootstrap itself (init.sql). */
    clusterAdmin: { port: number; superuserPassword: string }
  }
}

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle')

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Random per-run passwords: the instance only listens on loopback and lives for one run.
  const superuserPassword = randomBytes(12).toString('hex')
  const ownerPassword = randomBytes(12).toString('hex')
  const appPassword = randomBytes(12).toString('hex')

  await sweepStaleTestClusters()

  const dataDir = await mkdtemp(path.join(tmpdir(), 'pf-test-pg-'))
  const port = await findFreePort()
  const cluster = new Cluster({ dataDir, port, superuserPassword, throwaway: true })

  try {
    await cluster.initialise()
    await cluster.start()
    const init = { ownerPassword, appPassword, databases: ['pf_test'] }
    await applyInitSql({ port, superuserPassword }, init)
    // Applied twice on purpose: init.sql must be idempotent (it runs on every `npm run db`).
    await applyInitSql({ port, superuserPassword }, init)

    const ownerDatabaseUrl = connectionUrl({
      user: 'pf_owner',
      password: ownerPassword,
      port,
      database: 'pf_test',
    })
    const databaseUrl = connectionUrl({
      user: 'pf_app',
      password: appPassword,
      port,
      database: 'pf_test',
    })

    // With an empty journal (before build-sequence step 4) this is a no-op.
    const pool = new pg.Pool({ connectionString: ownerDatabaseUrl, max: 1 })
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
    } finally {
      await pool.end()
    }

    project.provide('databaseUrl', databaseUrl)
    project.provide('ownerDatabaseUrl', ownerDatabaseUrl)
    project.provide('clusterAdmin', { port, superuserPassword })
  } catch (error) {
    await cluster.stop().catch(() => {})
    throw error
  }

  return async () => {
    await cluster.stop()
  }
}
