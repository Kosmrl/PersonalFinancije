import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log, REDACTED } from './log'

// All data below is made up. OIB 12345678903 passes the checksum; the IBAN is a made-up HR
// number with the right shape (the logger matches the shape, not the checksum).
const FAKE_OIB = '12345678903'
const FAKE_IBAN = 'HR1210010051863000160'
const FAKE_EMAIL = 'ana.horvat@example.com'

let lines: Record<string, unknown>[]

beforeEach(() => {
  lines = []
  const capture = (line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>)
  }
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'warn').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function logged(): Record<string, unknown> {
  expect(lines).toHaveLength(1)
  return lines[0] as Record<string, unknown>
}

describe('log: key-based redaction', () => {
  it.each([
    'oib',
    'iban',
    'email',
    'password',
    'token',
    'name',
    'phone',
    'secret',
    'cookie',
    'authorization',
    'apiKey',
    'passphrase',
    'certificate',
    'pfxBlob',
    'p12File',
    'privateKey',
    'pinCode',
    'otpCode',
    'callbackUrl',
    'magicLink',
    'sentryDsn',
    'connectionString',
    'ipAddress',
    'adresa',
    'vatId',
    'sessionId',
    'credentials',
    'backupCodes',
  ])('redacts the value of "%s"', (key) => {
    log.info('event', { [key]: 'sensitive-value' })
    expect(logged()[key]).toBe(REDACTED)
  })

  it('matches keys case-insensitively and inside longer names', () => {
    log.info('event', { OWNER_EMAIL: 'x', userName: 'y', Access_Token: 'z' })
    expect(logged()).toMatchObject({
      OWNER_EMAIL: REDACTED,
      userName: REDACTED,
      Access_Token: REDACTED,
    })
  })

  it('redacts nested objects and arrays of objects', () => {
    log.info('event', { request: { headers: { cookie: 'a=b' }, ids: [{ email: 'x' }, { id: 7 }] } })
    expect(logged().request).toEqual({
      headers: { cookie: REDACTED },
      ids: [{ email: REDACTED }, { id: 7 }],
    })
  })

  it('keeps harmless fields', () => {
    log.info('event', { organizationId: 'org_1', count: 3, ok: true })
    expect(logged()).toMatchObject({ organizationId: 'org_1', count: 3, ok: true })
  })
})

describe('log: value scrubbing', () => {
  it('scrubs e-mail addresses, OIBs and HR IBANs from string values and the message', () => {
    log.warn(`failed for ${FAKE_EMAIL}`, {
      detail: `oib ${FAKE_OIB} iban ${FAKE_IBAN} mail ${FAKE_EMAIL}`,
      list: [`x ${FAKE_OIB}`],
    })
    const entry = logged()
    expect(entry.message).toBe('failed for [email]')
    expect(entry.detail).toBe('oib [oib] iban [iban] mail [email]')
    expect(entry.list).toEqual(['x [oib]'])
  })

  it('scrubs an IBAN written in groups of four', () => {
    log.info('event', { note: 'HR12 1001 0051 8630 0016 0' })
    expect(logged().note).toBe('[iban]')
  })

  it('does not touch numbers that are not 11 digits', () => {
    log.info('event', { note: 'order 1234567890 and 123456789012' })
    expect(logged().note).toBe('order 1234567890 and 123456789012')
  })
})

describe('log: scrubbing edge cases', () => {
  it('still matches realistic e-mail shapes', () => {
    log.info('event', {
      a: 'a.b+c@ex.example.test',
      b: 'first_last%x@sub-domain.example.co',
      c: '(ana@example.com),',
    })
    expect(logged()).toMatchObject({ a: '[email]', b: '[email]', c: '([email]),' })
  })

  it('leaves 10,000 random UUIDs unchanged, lower and upper case', () => {
    const uuids = Array.from({ length: 10_000 }, () => randomUUID())
    log.info('event', { ids: uuids, upper: uuids.slice(0, 2_000).map((u) => u.toUpperCase()) })
    const entry = logged()
    expect(entry.ids).toEqual(uuids)
    expect(entry.upper).toEqual(uuids.slice(0, 2_000).map((u) => u.toUpperCase()))
  })

  it('does not take an 11-digit group out of a longer run or a hex id', () => {
    log.info('event', {
      a: '123e4567-e89b-12d3-a456-554466440000',
      b: 'a46655440000',
      c: 'id12345678901',
      d: '123456789012',
      e: '1234567890123456',
    })
    expect(logged()).toMatchObject({
      a: '123e4567-e89b-12d3-a456-554466440000',
      b: 'a46655440000',
      c: 'id12345678901',
      d: '123456789012',
      e: '1234567890123456',
    })
  })

  it('scrubs an 11-digit OIB next to punctuation', () => {
    log.info('event', { a: `(${FAKE_OIB})`, b: `oib=${FAKE_OIB}.`, c: `${FAKE_OIB},x` })
    expect(logged()).toMatchObject({ a: '([oib])', b: 'oib=[oib].', c: '[oib],x' })
  })

  it('scrubs non-HR IBANs, plain and in groups, but not ids or lower-case tokens', () => {
    log.info('event', {
      de: 'DE89370400440532013000',
      deGrouped: 'DE89 3704 0044 0532 0130 00',
      gb: 'pay GB29NWBK60161331926819 now',
      lowerId: 'de89370400440532013000',
      shortCode: 'AB12CD34',
      orderRef: 'INV-2026-000123',
      hexId: 'f47ac10b58cc4372a5670e02b2c3d479',
    })
    expect(logged()).toMatchObject({
      de: '[iban]',
      deGrouped: '[iban]',
      gb: 'pay [iban] now',
      lowerId: 'de89370400440532013000',
      shortCode: 'AB12CD34',
      orderRef: 'INV-2026-000123',
      hexId: 'f47ac10b58cc4372a5670e02b2c3d479',
    })
  })

  it('scrubs bigint values', () => {
    log.info('event', { value: BigInt(FAKE_OIB), small: 42n })
    expect(logged()).toMatchObject({ value: '[oib]', small: '42' })
  })

  it('cuts long strings to 4 KB and marks the cut', () => {
    log.info('event', { text: 'abc '.repeat(5_000) })
    const text = logged().text as string
    expect(text.endsWith('…[truncated]')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(4_096 + '…[truncated]'.length)
  })

  it('never lets half an e-mail address or IBAN survive at the cut', () => {
    // The 4,096-character cut falls inside the address / IBAN.
    const email = `${'y '.repeat(2_040)}ana.horvat@example.com`
    const iban = `${'y '.repeat(2_044)}DE89370400440532013000`
    log.info('event', { first: email, second: iban })
    const entry = logged()
    expect(entry.first).not.toContain('ana.horvat')
    expect(entry.second).not.toContain('DE89')
    expect(entry.first).toMatch(/…\[truncated\]$/)
    expect(entry.second).toMatch(/…\[truncated\]$/)
  })
})

// A pattern that rescans from every position is quadratic: the original e-mail pattern needed
// 6 s for 100 KB. Strings are cut to 4 KB before scrubbing and every pattern is anchored and
// bounded, so these must be fast whatever the content. The bound is generous on purpose.
describe('log: scrubbing is linear (ReDoS)', () => {
  const LIMIT_MS = 250
  const MB = 1024 * 1024

  const alnum = 'aB3xZ9'.repeat(Math.ceil(MB / 6)).slice(0, MB)
  const base64 = Buffer.alloc(MB * 0.75, 'The quick brown fox').toString('base64')
  const digits = '1234567890'.repeat(Math.ceil(MB / 10)).slice(0, MB)
  const mailish = 'a.b-c_d+e%f'.repeat(Math.ceil(MB / 11)).slice(0, MB)
  const ibanish = 'HR12 3456 '.repeat(Math.ceil(MB / 10)).slice(0, MB)
  const capitals = 'DE89AB12CD34'.repeat(Math.ceil(MB / 12)).slice(0, MB)
  const atSigns = 'a@'.repeat(MB / 2)
  const dotted = ('a@' + 'b.'.repeat(30)).repeat(Math.ceil(MB / 62)).slice(0, MB)

  it.each([
    ['letters and digits without @', alnum],
    ['base64', base64],
    ['digits', digits],
    ['e-mail-like characters without @', mailish],
    ['IBAN-like groups', ibanish],
    ['capitals and digits', capitals],
    ['many @ signs', atSigns],
    ['many dotted domains', dotted],
  ])('scrubs 1 MB of %s quickly', (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(MB * 0.99)
    const start = performance.now()
    log.info(text, { text })
    expect(performance.now() - start).toBeLessThan(LIMIT_MS)
  })

  it('is fast on the worst case that fits under the 4 KB cap', () => {
    const start = performance.now()
    for (let i = 0; i < 50; i++) log.info('event', { text: alnum.slice(0, 4_000) })
    expect(performance.now() - start).toBeLessThan(LIMIT_MS * 4)
  })
})

describe('log: binary values and reserved keys', () => {
  it('replaces Buffers and typed arrays with their size', () => {
    log.info('event', {
      body: Buffer.from('secret'),
      bytes: new Uint8Array(4),
      buffer: new ArrayBuffer(8),
    })
    expect(logged()).toMatchObject({
      body: '[binary 6 bytes]',
      bytes: '[binary 4 bytes]',
      buffer: '[binary 8 bytes]',
    })
  })

  it('does not let caller fields overwrite level, time or message', () => {
    log.error('real message', { level: 'debug', time: 'yesterday', message: 'forged' })
    const entry = logged()
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('real message')
    expect(entry.time).not.toBe('yesterday')
  })
})

describe('log: errors', () => {
  it('logs only the class name and code of an error, never its message', () => {
    const error = Object.assign(new Error(`duplicate key for ${FAKE_EMAIL}`), { code: '23505' })
    log.error('query failed', { error })
    expect(logged().error).toEqual({ name: 'Error', code: '23505' })
  })
})

describe('log: odd errors', () => {
  it('does not throw when an error name is not a string', () => {
    const error = Object.assign(new Error('boom'), { name: { toString: () => 'x' } as unknown as string })
    expect(() => log.error('failed', { error })).not.toThrow()
    expect(logged().error).toEqual({ name: 'Error' })
  })
})

describe('log: wrapped errors', () => {
  it('logs the code found in .cause, never the wrapper message or params', async () => {
    const { DrizzleQueryError } = await import('drizzle-orm/errors')
    const cause = Object.assign(new Error(`key (oib)=(${FAKE_OIB}) exists`), { code: '23505' })
    const error = new DrizzleQueryError(
      'insert into customers (oib) values ($1)',
      [FAKE_OIB],
      cause,
    )
    log.error('query failed', { error })
    expect(logged().error).toEqual({ name: 'Error', code: '23505' })
    expect(JSON.stringify(lines)).not.toContain(FAKE_OIB)
  })
})

describe('log: levels', () => {
  it('writes to the matching console method and honours LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'warn')
    log.debug('d')
    log.info('i')
    log.warn('w')
    expect(lines.map((l) => l.message)).toEqual(['w'])
  })
})
