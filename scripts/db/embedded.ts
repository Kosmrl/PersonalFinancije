// Shared plumbing for the project-local PostgreSQL 17 that runs from node_modules
// (the `embedded-postgres` package, binaries from zonkyio/embedded-postgres-binaries).
// Used by `npm run db` (scripts/db/dev.ts) and by the integration-test globalSetup.
//
// This is tooling, not app code: it must not import anything from src/server (those modules
// start with `import 'server-only'`, which throws outside Next.js). Node 24 runs this file
// directly (type stripping), so: relative imports carry the .ts extension, `import type` for
// types, no enums or parameter properties.

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

export const CLUSTER_SUPERUSER = 'postgres'
const STARTUP_TIMEOUT_MS = 60_000

export type ClusterOptions = {
  dataDir: string
  port: number
  superuserPassword: string
  /** true for throwaway test clusters: fast but not crash-safe. */
  throwaway?: boolean
  /** Receives postgres/initdb log lines. Defaults to discarding them. */
  onLog?: (line: string) => void
}

type NativeBinaries = { postgres: string; initdb: string; pg_ctl: string }

async function loadBinaries(): Promise<NativeBinaries> {
  const platform = os.platform() === 'win32' ? 'windows' : os.platform()
  return (await import(`@embedded-postgres/${platform}-${os.arch()}`)) as NativeBinaries
}

function explainStartupError(output: string): string {
  if (/administrat/i.test(output)) {
    return (
      'PostgreSQL refuses to run from an elevated (administrator) process. ' +
      'Run this command from a normal, non-elevated terminal.'
    )
  }
  if (
    /could not create (any )?TCP\/IP socket|address already in use|Only one usage of each socket/i.test(
      output,
    )
  ) {
    return 'The PostgreSQL port is already in use. Stop the other server or choose another port.'
  }
  if (/lock file .* already exists|postmaster\.pid/i.test(output)) {
    return (
      'The data directory is locked by another PostgreSQL process (or a stale postmaster.pid). ' +
      'Stop the other process first.'
    )
  }
  return ''
}

/**
 * EmbeddedPostgres with a graceful lifecycle. The stock `start()`/`stop()` kill the server with
 * `taskkill /f` on Windows, which forces crash recovery on the next start. This subclass spawns
 * postgres itself and stops it with `pg_ctl stop -m fast`. The base class also stops every
 * instance from its process-exit hook (Ctrl+C, SIGTERM), and that goes through this `stop()`.
 */
export class Cluster extends EmbeddedPostgres {
  private child?: ChildProcess
  private exited?: Promise<void>
  private stopping?: Promise<void>
  private readonly dataDir: string
  private readonly port: number
  private readonly throwaway: boolean
  private readonly log: (line: string) => void

  constructor(opts: ClusterOptions) {
    const log = opts.onLog ?? (() => {})
    super({
      databaseDir: opts.dataDir,
      port: opts.port,
      user: CLUSTER_SUPERUSER,
      password: opts.superuserPassword,
      authMethod: 'scram-sha-256',
      persistent: true,
      // UTF-8 with the ICU Croatian collation, so lower()/ORDER BY handle č ć đ š ž.
      // Windows would otherwise pick a legacy code page (WIN1250) from the OS locale.
      initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=hr-HR'],
      onLog: (m) => log(String(m)),
      onError: (m) => log(String(m)),
    })
    this.dataDir = opts.dataDir
    this.port = opts.port
    this.throwaway = opts.throwaway ?? false
    this.log = log
  }

  override async initialise(): Promise<void> {
    try {
      await super.initialise()
    } catch (err) {
      const hint = explainStartupError(String(err instanceof Error ? err.message : err))
      throw new Error(`initdb failed. ${hint}`.trim(), { cause: err })
    }
  }

  /** Resolves once the server accepts connections; rejects if it exits first. */
  override async start(): Promise<void> {
    const { postgres } = await loadBinaries()
    const flags = [
      '-D',
      this.dataDir,
      '-p',
      String(this.port),
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      'timezone=UTC',
      '-c',
      'log_timezone=UTC',
      ...(this.throwaway
        ? ['-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off']
        : []),
    ]
    const child = spawn(postgres, flags, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    this.child = child
    this.exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))

    // Readiness is matched on the accumulated output, because a chunk boundary can split the
    // message. Accumulation stops once the server is ready (it only keeps the startup log).
    let output = ''
    let ready = false
    let timer: NodeJS.Timeout | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          this.log(text)
          if (ready) return
          output += text
          if (output.includes('database system is ready to accept connections')) {
            ready = true
            output = ''
            resolve()
          }
        })
        child.once('error', reject)
        child.once('exit', (code) => {
          const hint = explainStartupError(output)
          reject(
            new Error(
              `PostgreSQL exited during startup (code ${code}). ${hint}\n${output.trim()}`.trim(),
            ),
          )
        })
        timer = setTimeout(
          () =>
            reject(
              new Error(`PostgreSQL did not become ready within ${STARTUP_TIMEOUT_MS / 1000} s.`),
            ),
          STARTUP_TIMEOUT_MS,
        )
      })
    } catch (error) {
      await this.stop().catch(() => {})
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /** Waits until the server process has exited (for supervising `npm run db`). */
  waitForExit(): Promise<void> {
    return this.exited ?? Promise.resolve()
  }

  override stop(): Promise<void> {
    this.stopping ??= this.doStop()
    return this.stopping
  }

  private async doStop(): Promise<void> {
    const child = this.child
    if (child && child.exitCode === null) {
      const { pg_ctl } = await loadBinaries()
      // Fast shutdown: disconnect clients, checkpoint, exit. Non-zero means it was already stopping.
      await new Promise<void>((resolve) => {
        const ctl = spawn(pg_ctl, ['stop', '-D', this.dataDir, '-m', 'fast', '-w', '-t', '30'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        ctl.once('error', () => resolve())
        ctl.once('exit', () => resolve())
      })
      let timer: NodeJS.Timeout | undefined
      const exitedInTime = await Promise.race([
        this.exited?.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 15_000)
        }),
      ])
      clearTimeout(timer)
      if (!exitedInTime) {
        // Last resort: kill the process tree.
        if (os.platform() === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
        } else {
          child.kill('SIGKILL')
        }
        await this.exited
      }
    }
    this.child = undefined
    // Throwaway clusters leave nothing behind. Windows can hold file locks for a moment
    // after the process exits, hence the retries.
    if (this.throwaway) {
      await rm(this.dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }
}

/** Asks the OS for a free TCP port on loopback. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

export type InitOptions = {
  ownerPassword: string
  appPassword: string
  /** Databases to create (if missing) and lock down: pf_dev for the dev cluster, pf_test for tests. */
  databases: string[]
}

function superuserClient(cluster: { port: number; superuserPassword: string }): pg.Client {
  return new pg.Client({
    host: '127.0.0.1',
    port: cluster.port,
    user: CLUSTER_SUPERUSER,
    password: cluster.superuserPassword,
    database: 'postgres',
  })
}

/**
 * SCRAM-SHA-256 verifier (RFC 5802 / PostgreSQL format), computed here so the plaintext password
 * is never sent to the server in a statement that could end up in its log. SASLprep (RFC 4013)
 * normalisation is not implemented, so anything but printable ASCII is rejected.
 */
export function scramVerifier(password: string): string {
  // Anything outside printable ASCII (space to tilde) would need SASLprep normalisation.
  if (/[^ -~]/.test(password)) {
    throw new Error(
      'Database passwords must use printable ASCII only (the SCRAM verifier here skips SASLprep).',
    )
  }
  const iterations = 4096
  const salt = randomBytes(16)
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const clientKey = createHmac('sha256', salted).update('Client Key').digest()
  const storedKey = createHash('sha256').update(clientKey).digest()
  const serverKey = createHmac('sha256', salted).update('Server Key').digest()
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}

/**
 * Applies scripts/db/init.sql: roles pf_owner, pf_app and pf_definer, the given databases, and
 * their connection privileges. Idempotent; call it on every start. Role passwords follow the
 * values passed in, so changing them in .env.local takes effect at the next `npm run db`.
 */
export async function applyInitSql(
  cluster: { port: number; superuserPassword: string },
  options: InitOptions,
): Promise<void> {
  const sql = await readFile(fileURLToPath(new URL('./init.sql', import.meta.url)), 'utf-8')
  const [clusterSql, perDatabaseSql] = sql.split(/^-- per-database[ \t]*\r?$/m)
  if (!clusterSql?.trim() || !perDatabaseSql?.trim()) {
    throw new Error('init.sql must contain a "-- per-database" marker line.')
  }

  const client = superuserClient(cluster)
  await client.connect()
  try {
    // Session-level settings, read by init.sql through current_setting().
    await client.query("select set_config('pf.owner_verifier', $1, false)", [
      scramVerifier(options.ownerPassword),
    ])
    await client.query("select set_config('pf.app_verifier', $1, false)", [
      scramVerifier(options.appPassword),
    ])
    await client.query(clusterSql)

    for (const database of options.databases) {
      const exists = await client.query('select 1 from pg_database where datname = $1', [database])
      if (exists.rowCount === 0) {
        await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)} OWNER pf_owner`)
      }
      await client.query("select set_config('pf.database', $1, false)", [database])
      await client.query(perDatabaseSql)
    }
  } finally {
    await client.end()
  }
}

const STALE_DIR_PREFIX = 'pf-test-pg-'
const STALE_DIR_MIN_AGE_MS = 10 * 60 * 1000

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Deletes leftovers of earlier test runs that were killed before they could clean up: temp
 * directories named pf-test-pg-* that are older than ten minutes and have no live
 * postmaster.pid. A directory whose postmaster is still alive is left alone.
 */
export async function sweepStaleTestClusters(): Promise<void> {
  const root = os.tmpdir()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(STALE_DIR_PREFIX)) continue
    const dir = path.join(root, name)
    try {
      const info = await stat(dir)
      if (!info.isDirectory() || Date.now() - info.mtimeMs < STALE_DIR_MIN_AGE_MS) continue
      const pidText = await readFile(path.join(dir, 'postmaster.pid'), 'utf-8').catch(() => '')
      const pid = Number.parseInt(pidText.split(/\r?\n/)[0] ?? '', 10)
      if (Number.isInteger(pid) && processIsAlive(pid)) continue
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // Best effort: another run may be deleting the same directory.
    }
  }
}

export function connectionUrl(opts: {
  user: string
  password: string
  port: number
  database: string
}): string {
  const user = encodeURIComponent(opts.user)
  const password = encodeURIComponent(opts.password)
  return `postgres://${user}:${password}@127.0.0.1:${opts.port}/${opts.database}`
}
