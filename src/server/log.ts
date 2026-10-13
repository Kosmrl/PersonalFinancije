import 'server-only'
import { errorCode } from './db/errors'

// Minimal structured logger: one JSON object per line on the console, with key-based redaction.
// CLAUDE.md (Privacy): never log invoice contents, amounts, OIBs or certificate data next to
// identity, and never request bodies. Pass identifiers (ids, error codes), not user data.

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

// A key is redacted when its lower-cased name contains any of these fragments, so
// `ownerEmail`, `access_token` and `userName` are caught as well as the exact names. The list errs
// on the side of over-redacting (`pin` also hides `shippingX`): a missing value in a log line
// is cheaper than a leaked OIB.
const REDACTED_KEY_FRAGMENTS = [
  'oib',
  'iban',
  'email',
  'password',
  'pass',
  'token',
  'name',
  'phone',
  'secret',
  'cookie',
  'authorization',
  'key',
  'cert',
  'pfx',
  'p12',
  'private',
  'pin',
  'otp',
  'url',
  'link',
  'dsn',
  'connection',
  'address',
  'adresa',
  'vat',
  'session',
  'credential',
  'backup',
]
export const REDACTED = '[redacted]'
const MAX_DEPTH = 5

// Values are scrubbed as well, because personal data also arrives under harmless keys
// (`message`, `detail`, a URL, a stack of text): e-mail addresses, 11-digit OIBs, IBANs.
//
// Every pattern is anchored on a boundary (a lookbehind) and every quantifier is bounded, so a
// match attempt costs a constant amount per position and a long string cannot make it
// quadratic. Unanchored `[...]+@` patterns rescan from every position and froze the server on
// strings of a few hundred KB (ReDoS). On top of that, strings are cut to MAX_STRING_LENGTH
// before scrubbing.
const SCRUBBERS: [RegExp, string][] = [
  [
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g,
    '[email]',
  ],
  // HR IBAN (HR + 19 digits), also in groups, in any case. Shape only, not the checksum: a
  // mistyped IBAN is exactly what ends up in a validation error.
  [/(?<![A-Za-z0-9])HR(?:\s?\d){19}(?![A-Za-z0-9])/gi, '[iban]'],
  // Any other IBAN: two capital letters, two check digits, 11 to 30 capital letters or digits,
  // optionally in groups. Capitals only, so lower-case ids, hashes and UUIDs never match.
  [/(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}(?![A-Za-z0-9])/g, '[iban]'],
  // OIB: exactly 11 digits that are not part of a longer run of letters or digits, so the digit
  // groups of UUIDs, hex ids and long numbers are left alone.
  [/(?<![0-9A-Za-z])\d{11}(?![0-9A-Za-z])/g, '[oib]'],
]

const MAX_STRING_LENGTH = 4096
const TRUNCATED_MARK = '…[truncated]'
const TOKEN_TAIL = 320

// Cuts a long string, and also drops the token the cut landed in, so that half of an e-mail
// address or IBAN can never survive scrubbing at the boundary.
function truncate(text: string): string {
  if (text.length <= MAX_STRING_LENGTH) return text
  const cut = text.slice(0, MAX_STRING_LENGTH)
  const tail = cut.slice(-TOKEN_TAIL)
  const tokenStart = tail.search(/[^\s"',;<>()]*$/)
  const kept = tokenStart > 0 ? cut.slice(0, cut.length - TOKEN_TAIL + tokenStart) : cut
  return kept + TRUNCATED_MARK
}

function scrub(text: string): string {
  return SCRUBBERS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    truncate(text),
  )
}

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase()
  return REDACTED_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrub(value)
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? scrub(value.toString()) : value
  }
  // Raw bytes (a request body, a certificate) are never logged, only their size.
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength} bytes]`
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return describeError(value)
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1, seen))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = isRedactedKey(key) ? REDACTED : sanitize(item, depth + 1, seen)
  }
  return out
}

function describeError(error: Error): Record<string, unknown> {
  // Error messages (notably from database drivers) can embed row values, and drizzle-orm's
  // DrizzleQueryError message carries the bind parameters, so only the class name and the code
  // are logged. The code is looked up along `.cause`, where the driver's SQLSTATE lives.
  // Debug a failure by its code.
  const code = errorCode(error)
  return {
    name: typeof error.name === 'string' ? scrub(error.name) : 'Error',
    ...(code !== undefined ? { code: scrub(code) } : {}),
  }
}

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined
  const fallback: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  return LEVEL_ORDER[configured && configured in LEVEL_ORDER ? configured : fallback]
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold()) return
  // The caller's fields come first so they cannot overwrite level, time or message.
  const entry = {
    ...(fields ? (sanitize(fields, 0, new WeakSet()) as Record<string, unknown>) : {}),
    level,
    time: new Date().toISOString(),
    message: scrub(message),
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
}
