import { describe, expect, it } from 'vitest'
import { MoneyError } from './decimal'
import { formatCents, formatDecimal } from './format'
import { parseDecimal } from './parse'

// Intl separates the amount and the currency symbol with a NBSP (or narrow NBSP), and since
// Node 24 / ICU 77 uses U+2212 for the minus sign (developer decision 1). Normalize both, so
// the assertions read like the plan: `-5,00 €`.
const plain = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-')

describe('formatCents', () => {
  it.each([
    // Plan table
    [0, '0,00 €'],
    [1, '0,01 €'],
    [123456, '1.234,56 €'],
    [-500, '-5,00 €'],
    // Around the decimal comma and the first grouping separator
    [9, '0,09 €'],
    [10, '0,10 €'],
    [99, '0,99 €'],
    [100, '1,00 €'],
    [101, '1,01 €'],
    [99_999, '999,99 €'],
    [100_000, '1.000,00 €'],
    [100_001, '1.000,01 €'],
    [123_456_789, '1.234.567,89 €'],
    // Negative values
    [-1, '-0,01 €'],
    [-99, '-0,99 €'],
    [-100_000, '-1.000,00 €'],
    [-123_456, '-1.234,56 €'],
    // Very large: exact, no float rounding (the default parse max, then the largest safe integer)
    [99_999_999_999, '999.999.999,99 €'],
    [Number.MAX_SAFE_INTEGER, '90.071.992.547.409,91 €'],
    [-Number.MAX_SAFE_INTEGER, '-90.071.992.547.409,91 €'],
  ])('formatCents(%i) = %s', (cents, expected) => {
    expect(plain(formatCents(cents))).toBe(expected)
  })

  it('formats negative zero as zero, not "-0,00 €"', () => {
    expect(plain(formatCents(-0))).toBe('0,00 €')
  })

  it('puts a non-breaking space between the amount and the symbol', () => {
    expect(formatCents(123456)).toMatch(/^1\.234,56[  ]€$/)
  })

  it('uses a real minus sign for money out, which parseAmountToCents accepts', () => {
    expect(formatCents(-500)).toMatch(/^[-−]5,00[  ]€$/)
  })

  it('defaults to EUR and uses the minor-unit digits of other currencies', () => {
    expect(formatCents(123456)).toBe(formatCents(123456, 'EUR'))
    expect(plain(formatCents(123456, 'USD'))).toMatch(/^1\.234,56 (USD|US\$|\$)$/)
    // JPY has no minor units: 500 "cents" are 500 yen.
    expect(plain(formatCents(500, 'JPY'))).toMatch(/^500 (JPY|¥)$/)
    // KWD has three.
    expect(plain(formatCents(1234, 'KWD'))).toMatch(/^1,234 (KWD|KD)$/)
  })

  it('rejects an invalid currency code', () => {
    expect(() => formatCents(100, 'euro')).toThrow(RangeError)
    expect(() => formatCents(100, '')).toThrow(RangeError)
  })

  it.each([
    ['1.5', 1.5],
    ['0.1', 0.1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['2^53', 2 ** 53],
    ['-(2^53)', -(2 ** 53)],
    ['1e21', 1e21],
  ])('throws a MoneyError for non-integer or unsafe cents: %s', (_name, cents) => {
    expect(() => formatCents(cents)).toThrow(MoneyError)
    try {
      formatCents(cents)
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_decimal' })
    }
  })
})

describe('formatDecimal', () => {
  it.each([
    // Plan table
    ['0.125', '0,125 €'],
    ['12.000000', '12,00 €'],
    ['1234.5', '1.234,50 €'],
    ['999999999.999999', '999.999.999,999999 €'],
    // At least 2 decimals, trailing zeros trimmed down to that
    ['0', '0,00 €'],
    ['12', '12,00 €'],
    ['12.5', '12,50 €'],
    ['12.50', '12,50 €'],
    ['12.500', '12,50 €'],
    ['0.100000', '0,10 €'],
    ['0.1250', '0,125 €'],
    ['0.000001', '0,000001 €'],
    ['0.0000001', '0,0000001 €'], // never exponent notation
    ['1.123456', '1,123456 €'],
    ['1234567.1', '1.234.567,10 €'],
    ['1000', '1.000,00 €'],
    // Negative values and negative zero
    ['-0.125', '-0,125 €'],
    ['-1234.5', '-1.234,50 €'],
    ['-12', '-12,00 €'],
    ['-0', '0,00 €'],
    ['-0.00', '0,00 €'],
    ['-0.000000', '0,00 €'],
    // More digits than a float can hold stay exact
    ['12345678901234567890.123456', '12.345.678.901.234.567.890,123456 €'],
    ['0.1234567890123456789', '0,1234567890123456789 €'],
  ])('formatDecimal(%j) = %s', (value, expected) => {
    expect(plain(formatDecimal(value, 'EUR'))).toBe(expected)
  })

  it('defaults to EUR and accepts another currency', () => {
    expect(formatDecimal('0.125')).toBe(formatDecimal('0.125', 'EUR'))
    expect(plain(formatDecimal('0.125', 'USD'))).toMatch(/^0,125 (USD|US\$|\$)$/)
  })

  it.each(['', ' ', 'abc', '1e3', '1,5', '.5', '5.', '1.2.3', 'NaN', 'Infinity', ' 1'])(
    'throws a MoneyError for the invalid decimal string %j',
    (value) => {
      expect(() => formatDecimal(value)).toThrow(MoneyError)
    },
  )

  it('rejects an invalid currency code', () => {
    expect(() => formatDecimal('1', 'euro')).toThrow(RangeError)
  })
})

describe('display formatting stays parseable (plan item 4)', () => {
  const asInput = (value: string) => plain(formatDecimal(value)).replace(/ €$/, '')

  it('parseDecimal(formatDecimal(x)) equals x for a sample of values', () => {
    for (const value of [
      '0',
      '0.125',
      '0.000001',
      '0.5',
      '1',
      '12',
      '12.5',
      '999',
      '1000',
      '1234.5',
      '1234.567',
      '1234567.89',
      '999999999.999999',
      '12345678901234567890.123456',
    ]) {
      expect(parseDecimal(asInput(value)), `value ${value}`).toEqual({ ok: true, value })
    }
  })

  it('also holds for negative values when negatives are allowed', () => {
    for (const value of ['-0.125', '-1', '-1234.5', '-999999999.999999']) {
      const raw = formatDecimal(value).replace(/[   ]€$/, '')
      expect(parseDecimal(raw, { allowNegative: true }), `value ${value}`).toEqual({
        ok: true,
        value,
      })
    }
  })
})
