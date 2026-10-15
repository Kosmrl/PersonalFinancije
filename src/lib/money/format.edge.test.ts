import { describe, expect, it } from 'vitest'
import { Decimal, MoneyError } from './decimal'
import { decimalToInputText, formatDecimalPlain } from './format'
import { parseDecimal } from './parse'

const plain = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-')

describe('format edge cases for item prices', () => {
  it.each([
    ['0.000000', '0'],
    ['100.000000', '100'],
    ['0.100000', '0,1'],
    ['0.000001', '0,000001'],
    ['999999999.999999', '999999999,999999'],
    ['12345678901234567890.123456', '12345678901234567890,123456'],
  ])('decimalToInputText(%s) = %s', (stored, text) => {
    expect(decimalToInputText(stored)).toBe(text)
  })

  it.each([
    ['0.000001', '0,000001'],
    ['999999999.999999', '999.999.999,999999'],
    ['1000', '1.000,00'],
    ['0', '0,00'],
    ['-0', '0,00'],
  ])('formatDecimalPlain(%s) = %s', (value, expected) => {
    expect(plain(formatDecimalPlain(value))).toBe(expected)
  })

  it.each(['', 'abc', '1,5', '1e3', ' 1'])('both helpers throw MoneyError on %j', (v) => {
    expect(() => formatDecimalPlain(v)).toThrow(MoneyError)
    expect(() => decimalToInputText(v)).toThrow(MoneyError)
  })

  it('round trip: stored -> edit text -> parse -> same value', () => {
    for (const stored of ['0.125000', '50.000000', '1234.567800', '0.000001', '999999999.999999']) {
      const parsed = parseDecimal(decimalToInputText(stored))
      expect(parsed.ok && parsed.value).toBe(stored.replace(/\.?0+$/, ''))
    }
  })

  it('round trip through the grouped blur format stays parseable', () => {
    for (const stored of ['1234.5', '999999999.999999', '0.125', '1000000']) {
      const parsed = parseDecimal(plain(formatDecimalPlain(stored)))
      expect(parsed.ok && new Decimal(parsed.value).eq(stored)).toBe(true)
    }
  })
})
