import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import {
  errorCode,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  pgErrorCode,
} from './errors'

// Made-up personal data in the bind parameters: it must never surface.
function drizzleError(pgFields: Record<string, unknown>) {
  const pgError = Object.assign(
    new Error('duplicate key value violates unique constraint'),
    pgFields,
  )
  return new DrizzleQueryError(
    'insert into customers (name, oib) values ($1, $2)',
    ['Ana Horvat', '12345678903'],
    pgError,
  )
}

describe('pgErrorCode', () => {
  it('finds the SQLSTATE in .cause of a DrizzleQueryError', () => {
    const error = drizzleError({ code: '23505', constraint: 'customers_pkey' })
    expect(error).not.toHaveProperty('code')
    expect(pgErrorCode(error)).toBe('23505')
  })

  it('returns the code of a bare driver error', () => {
    expect(pgErrorCode(Object.assign(new Error('x'), { code: '42501' }))).toBe('42501')
  })

  it('ignores codes that are not SQLSTATEs and non-errors', () => {
    expect(pgErrorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeUndefined()
    expect(pgErrorCode(new Error('plain'))).toBeUndefined()
    expect(pgErrorCode(null)).toBeUndefined()
    expect(pgErrorCode('23505')).toBeUndefined()
  })

  it('survives a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    a.cause = a
    expect(pgErrorCode(a)).toBeUndefined()
  })
})

describe('errorCode', () => {
  it('also returns Node system codes along the cause chain', () => {
    const error = new Error('wrapper', {
      cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
    })
    expect(errorCode(error)).toBe('ECONNREFUSED')
  })
})

describe('violation helpers', () => {
  it('isUniqueViolation matches 23505, optionally by constraint name', () => {
    const error = drizzleError({
      code: '23505',
      constraint: 'customers_organization_id_oib_active_uidx',
    })
    expect(isUniqueViolation(error)).toBe(true)
    expect(isUniqueViolation(error, 'customers_organization_id_oib_active_uidx')).toBe(true)
    expect(isUniqueViolation(error, 'some_other_constraint')).toBe(false)
  })

  it('does not confuse the violation kinds', () => {
    const fk = drizzleError({ code: '23503', constraint: 'fk' })
    const check = drizzleError({ code: '23514', constraint: 'c' })
    expect(isUniqueViolation(fk)).toBe(false)
    expect(isForeignKeyViolation(fk, 'fk')).toBe(true)
    expect(isCheckViolation(check, 'c')).toBe(true)
    expect(isCheckViolation(fk)).toBe(false)
    expect(isUniqueViolation(new Error('x'))).toBe(false)
  })
})
