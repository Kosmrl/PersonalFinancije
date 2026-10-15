// `npm run e2e` (Playwright webServer): brings up everything the browser tests need, in one
// process, and keeps running until Playwright stops it.
//
//   1. a throwaway PostgreSQL 17 (temp directory, free port; never .data/postgres)
//   2. roles and the pf_e2e database (scripts/db/init.sql) and the Drizzle migrations
//   3. the local mail catcher (SMTP E2E_SMTP_PORT, HTTP API E2E_MAIL_HTTP_PORT)
//   4. the app (`next dev` on E2E_APP_PORT, its own build directory .next-e2e)
//
// Isolation: every setting is passed to the app explicitly, so nothing from .env.local (the
// developer's database, secrets, mail catcher) is used. Ports default to 3100 / 1125 / 1180, so a
// running `npm run dev`, `npm run db` or `npm run mail` does not clash. Secrets are random per run.
// Every variable in the env.ts schema must therefore be set explicitly below (checked at startup);
// otherwise Next would fill the gap from .env.local.
//
// Quirk: `next dev` rewrites next-env.d.ts to point at .next-e2e. The stack restores the default
// (.next) version on shutdown, but Playwright may kill it hard (always on Windows), so this is
// best effort. If the file still points at .next-e2e, run `npm run dev` or `npm run build` once,
// or delete next-env.d.ts; `npm run typecheck` works either way.
//
// Tooling, not app code: Node 24 runs this file directly (type stripping).

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import {
  applyInitSql,
  Cluster,
  connectionUrl,
  findFreePort,
  sweepStaleTestClusters,
} from '../db/embedded.ts'
import { startMailCatcher } from '../mail/catcher.ts'

function port(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid ${name}: ${process.env[name]}`)
  }
  return value
}

const appPort = port('E2E_APP_PORT', 3100)
const smtpPort = port('E2E_SMTP_PORT', 1125)
const mailHttpPort = port('E2E_MAIL_HTTP_PORT', 1180)
const root = path.resolve(import.meta.dirname, '../..')

const envSchemaKeys = [
  ...(await readFile(path.join(root, 'src/server/env.ts'), 'utf8')).matchAll(
    /^ {2}([A-Z][A-Z0-9_]+):/gm,
  ),
].map((match) => match[1]!)
const nextEnvFile = path.join(root, 'next-env.d.ts')

const DEFAULT_NEXT_ENV = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/dev/types/routes.d.ts";
import "./.next/dev/types/root-params.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`

const secret = () => randomBytes(16).toString('hex')
const superuserPassword = secret()
const ownerPassword = secret()
const appPassword = secret()

await sweepStaleTestClusters()
const dataDir = await mkdtemp(path.join(tmpdir(), 'pf-test-pg-'))
const dbPort = await findFreePort()
const cluster = new Cluster({ dataDir, port: dbPort, superuserPassword, throwaway: true })

let app: ReturnType<typeof spawn> | undefined
let catcher: Awaited<ReturnType<typeof startMailCatcher>> | undefined
let stopping = false

async function shutdown(code: number): Promise<void> {
  if (stopping) return
  stopping = true
  if (app && app.exitCode === null && app.pid) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(app.pid), '/f', '/t'], { stdio: 'ignore' })
    } else {
      app.kill('SIGTERM')
    }
  }
  await writeFile(nextEnvFile, DEFAULT_NEXT_ENV).catch(() => {})
  await catcher?.close().catch(() => {})
  await cluster.stop().catch(() => {})
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
  process.on(signal, () => void shutdown(0))
}

try {
  await cluster.initialise()
  await cluster.start()
  await applyInitSql(
    { port: dbPort, superuserPassword },
    { ownerPassword, appPassword, databases: ['pf_e2e'] },
  )
  const ownerUrl = connectionUrl({
    user: 'pf_owner',
    password: ownerPassword,
    port: dbPort,
    database: 'pf_e2e',
  })
  const appUrl = connectionUrl({
    user: 'pf_app',
    password: appPassword,
    port: dbPort,
    database: 'pf_e2e',
  })
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(root, 'drizzle') })
  } finally {
    await pool.end()
  }

  catcher = await startMailCatcher({ smtpPort, httpPort: mailHttpPort })

  const baseUrl = `http://localhost:${appPort}`
  const appEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    NEXT_DIST_DIR: '.next-e2e',
    NEXT_TELEMETRY_DISABLED: '1',
    APP_NAME: 'PersonalFinancije',
    DATABASE_URL: appUrl,
    DATABASE_MIGRATION_URL: ownerUrl,
    BETTER_AUTH_SECRET: secret() + secret(),
    BETTER_AUTH_URL: baseUrl,
    TRUSTED_ORIGINS: baseUrl,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtpPort),
    SMTP_USER: '',
    SMTP_PASS: '',
    MAIL_FROM: 'PersonalFinancije <no-reply@example.test>',
    // Enables the test-only hooks in src/server/test-hooks.ts (never active in production).
    PF_E2E: '1',
  }
  const missing = envSchemaKeys.filter((key) => !(key in appEnv))
  if (missing.length > 0) {
    throw new Error(
      `stack.ts must set every env.ts variable explicitly; missing: ${missing.join(', ')}`,
    )
  }
  const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
  app = spawn(process.execPath, [next, 'dev', '-p', String(appPort)], {
    cwd: root,
    stdio: 'inherit',
    env: appEnv,
  })
  app.once('exit', (code) => {
    if (!stopping) {
      console.error(`next dev exited unexpectedly (code ${code}).`)
      void shutdown(1)
    }
  })
  console.log(`e2e stack ready: app ${baseUrl}, mail API http://127.0.0.1:${mailHttpPort}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await shutdown(1)
}
