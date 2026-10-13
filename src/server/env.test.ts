import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BASE = {
  DATABASE_URL: 'postgres://pf_app:pw@127.0.0.1:5433/pf_dev',
}

async function load(env: Record<string, string>) {
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const key of [
    'DATABASE_URL',
    'DATABASE_MIGRATION_URL',
    'BETTER_AUTH_SECRET',
    'SMTP_PORT',
    'SMTP_USER',
    'TRUSTED_ORIGINS',
  ]) {
    vi.stubEnv(key, undefined)
  }
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return (await import('./env')).getEnv
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllEnvs())

describe('getEnv', () => {
  it('needs only DATABASE_URL at step 2', async () => {
    const getEnv = await load(BASE)
    const env = getEnv()
    expect(env.DATABASE_URL).toBe(BASE.DATABASE_URL)
    expect(env.APP_NAME).toBe('PersonalFinancije')
    expect(env.SMTP_PORT).toBeUndefined()
  })

  it('names the failing variable but never echoes its value', async () => {
    const getEnv = await load({ DATABASE_URL: 'mysql://user:hunter2@host/db' })
    expect(() => getEnv()).toThrow(/DATABASE_URL/)
    expect(() => getEnv()).not.toThrow(/hunter2/)
  })

  it('treats empty strings as unset', async () => {
    const getEnv = await load({ ...BASE, SMTP_USER: '', SMTP_PORT: '' })
    expect(getEnv().SMTP_USER).toBeUndefined()
    expect(getEnv().SMTP_PORT).toBeUndefined()
  })

  it.each(['1', '25', '1025', '65535', '10000'])('accepts SMTP_PORT %s', async (port) => {
    const getEnv = await load({ ...BASE, SMTP_PORT: port })
    expect(getEnv().SMTP_PORT).toBe(port)
  })

  it.each(['0', '65536', '99999', '100000', '01025', '-1', '1e3', '10.5', 'abc', ' 25', '0x10'])(
    'rejects SMTP_PORT %j',
    async (port) => {
      const getEnv = await load({ ...BASE, SMTP_PORT: port })
      expect(() => getEnv()).toThrow(/SMTP_PORT/)
    },
  )

  it('splits TRUSTED_ORIGINS into a list of URLs', async () => {
    const getEnv = await load({
      ...BASE,
      TRUSTED_ORIGINS: 'http://localhost:3000, https://app.example.test',
    })
    expect(getEnv().TRUSTED_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.test'])
  })

  it('requires BETTER_AUTH_SECRET to be at least 32 characters when set', async () => {
    const getEnv = await load({ ...BASE, BETTER_AUTH_SECRET: 'too-short' })
    expect(() => getEnv()).toThrow(/BETTER_AUTH_SECRET/)
  })
})
