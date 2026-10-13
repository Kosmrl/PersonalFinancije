// `npm run db`: runs the development PostgreSQL in the foreground until Ctrl+C.
//
// - data directory: .data/postgres (gitignored), cluster created on first run
// - port: DB_PORT (default 5433)
// - roles and the pf_dev database: scripts/db/init.sql, applied idempotently on every start
//
// Settings come from .env.local (copy .env.example). Dev-only passwords, never for production.

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { applyInitSql, Cluster, connectionUrl } from './embedded.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and run again.`)
    process.exit(1)
  }
  return value
}

const port = Number.parseInt(process.env.DB_PORT ?? '5433', 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid DB_PORT: ${process.env.DB_PORT}`)
  process.exit(1)
}
const superuserPassword = required('PG_SUPERUSER_PASSWORD')
const ownerPassword = required('PF_OWNER_PASSWORD')
const appPassword = required('PF_APP_PASSWORD')

const dataDir = path.resolve(process.cwd(), '.data', 'postgres')
const verbose = process.env.DB_VERBOSE === '1'
const cluster = new Cluster({
  dataDir,
  port,
  superuserPassword,
  // initdb output is noise unless something fails; postgres's own log is shown only on request.
  onLog: (line) => {
    if (verbose) process.stdout.write(line)
  },
})

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n${signal} received, stopping PostgreSQL...`)
  await cluster.stop()
  console.log('PostgreSQL stopped.')
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGBREAK', () => void shutdown('SIGBREAK'))

// Where a failure happened decides what advice is useful.
let phase: 'initdb' | 'start' | 'init-sql' = 'start'
try {
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    phase = 'initdb'
    console.log(`Creating PostgreSQL cluster in ${path.relative(process.cwd(), dataDir)} ...`)
    await mkdir(path.dirname(dataDir), { recursive: true })
    await cluster.initialise()
  }

  phase = 'start'
  console.log(`Starting PostgreSQL 17 on 127.0.0.1:${port} ...`)
  await cluster.start()

  // Idempotent: creates what is missing (roles, pf_dev) and repairs the rest, on every start.
  phase = 'init-sql'
  console.log('Applying roles and databases (scripts/db/init.sql) ...')
  await applyInitSql(
    { port, superuserPassword },
    { ownerPassword, appPassword, databases: ['pf_dev'] },
  )
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  if (err instanceof Error && err.cause && verbose) console.error(err.cause)
  if (phase === 'initdb') {
    console.error('If .data/postgres is half-created, delete it and run again.')
  } else if (phase === 'init-sql') {
    console.error(
      'init.sql failed. It is safe to run again; if it keeps failing, delete .data/postgres (this erases the dev database).',
    )
  }
  await cluster.stop().catch(() => {})
  process.exit(1)
}

console.log('')
console.log('PostgreSQL is ready. Press Ctrl+C to stop.')
console.log(
  `  runtime:    ${connectionUrl({ user: 'pf_app', password: '***', port, database: 'pf_dev' })}`,
)
console.log(
  `  migrations: ${connectionUrl({ user: 'pf_owner', password: '***', port, database: 'pf_dev' })}`,
)

await cluster.waitForExit()
if (!shuttingDown) {
  console.error('PostgreSQL exited unexpectedly. Run with DB_VERBOSE=1 for its log.')
  process.exit(1)
}
