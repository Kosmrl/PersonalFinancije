import { DrizzleQueryError } from 'drizzle-orm/errors'
import { notFound, redirect } from 'next/navigation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, GENERIC_ERROR_MESSAGE, ok, runAction } from './result'

// Real redirect() and notFound() errors are used on purpose: runAction must let them through.

let lines: string[]

beforeEach(() => {
  lines = []
  const capture = (line: unknown) => {
    lines.push(String(line))
  }
  vi.spyOn(console, 'error').mockImplementation(capture)
  vi.spyOn(console, 'warn').mockImplementation(capture)
  vi.spyOn(console, 'log').mockImplementation(capture)
})
afterEach(() => vi.restoreAllMocks())

describe('runAction', () => {
  it('passes a result through unchanged', async () => {
    expect(await runAction('customer.created', async () => ok({ id: 1 }))).toEqual({
      ok: true,
      data: { id: 1 },
    })
    expect(await runAction('customer.created', async () => fail('Neispravan unos.'))).toEqual({
      ok: false,
      message: 'Neispravan unos.',
    })
    expect(lines).toHaveLength(0)
  })

  it('rethrows redirect()', async () => {
    await expect(
      runAction('customer.created', async () => {
        redirect('/prijava')
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect(lines).toHaveLength(0)
  })

  it('rethrows notFound()', async () => {
    await expect(
      runAction('customer.created', async () => {
        notFound()
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') })
    expect(lines).toHaveLength(0)
  })

  it('turns a database error into the generic Croatian failure and logs only the code', async () => {
    const pgError = Object.assign(new Error('duplicate key: Key (oib)=(12345678903) exists'), {
      code: '23505',
      detail: 'Key (oib)=(12345678903) already exists.',
    })
    const error = new DrizzleQueryError(
      'insert into customers (name, oib, email) values ($1, $2, $3)',
      ['Ana Horvat', '12345678903', 'ana.horvat@example.test'],
      pgError,
    )
    const result = await runAction('customer.created', async () => {
      throw error
    })
    expect(result).toEqual({ ok: false, message: GENERIC_ERROR_MESSAGE })

    expect(lines).toHaveLength(1)
    const logged = lines[0]!
    for (const secret of [
      'Ana',
      'Horvat',
      '12345678903',
      'ana.horvat',
      'insert into',
      'duplicate key',
    ]) {
      expect(logged).not.toContain(secret)
    }
    expect(JSON.parse(logged)).toMatchObject({
      level: 'error',
      action: 'customer.created',
      error: { name: 'Error', code: '23505' },
    })
  })

  it('handles a thrown non-Error value', async () => {
    const result = await runAction('customer.created', async () => {
      throw 'plain string with ana.horvat@example.test'
    })
    expect(result).toEqual({ ok: false, message: GENERIC_ERROR_MESSAGE })
    expect(lines.join('')).not.toContain('ana.horvat')
  })
})
