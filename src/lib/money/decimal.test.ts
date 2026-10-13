import DecimalBase from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { Decimal, MoneyError, toDecimal } from './decimal'

describe('Decimal configuration (roadmap §4.5)', () => {
  it('uses 40 significant digits and ROUND_HALF_UP', () => {
    expect(Decimal.precision).toBe(40)
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP)
  })

  it('is a clone: the global decimal.js precision is neither used nor changed', () => {
    expect(DecimalBase.precision).not.toBe(40)
    expect(Decimal).not.toBe(DecimalBase)
  })

  it('does float-free arithmetic', () => {
    expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3')
    expect(new Decimal('1.005').times(100).toString()).toBe('100.5')
    expect(new Decimal('0.1').times(3).toString()).toBe('0.3')
  })

  it.each([
    ['0.5', '1'],
    ['-0.5', '-1'],
    ['1.5', '2'],
    ['2.5', '3'],
    ['-2.5', '-3'],
    ['1.4999999', '1'],
    ['-1.4999999', '-1'],
    ['0.4999999', '0'],
  ])('rounds %s to a whole number as %s (ties away from zero)', (value, expected) => {
    expect(new Decimal(value).toDecimalPlaces(0).toString()).toBe(expected)
  })

  it('rounds to cents symmetrically around zero', () => {
    expect(new Decimal('49.995').toDecimalPlaces(2).toString()).toBe('50')
    expect(new Decimal('-49.995').toDecimalPlaces(2).toString()).toBe('-50')
  })

  it('keeps 40 significant digits in a division', () => {
    expect(new Decimal(1).div(3).toString()).toBe('0.3333333333333333333333333333333333333333')
  })

  it('never prints exponent notation', () => {
    expect(new Decimal('1e-7').toString()).toBe('0.0000001')
    expect(new Decimal('1e30').toString()).toBe('1000000000000000000000000000000')
    expect(new Decimal('0.000000000000000000001').toString()).toBe('0.000000000000000000001')
  })
})

describe('toDecimal', () => {
  it.each([
    ['0', '0'],
    ['1', '1'],
    ['+1', '1'],
    ['-1.5', '-1.5'],
    ['0.000001', '0.000001'],
    ['007', '7'],
    ['1.50', '1.5'],
    ['999999999.999999', '999999999.999999'],
    ['12345678901234567890.123456', '12345678901234567890.123456'],
  ])('accepts the string %j', (input, expected) => {
    expect(toDecimal(input).toString()).toBe(expected)
  })

  it.each([
    '',
    ' ',
    ' 1',
    '1 ',
    '1e3',
    '1E3',
    '.5',
    '5.',
    '1,5',
    '1.2.3',
    '--1',
    '+-1',
    '0x10',
    'abc',
    'NaN',
    'Infinity',
    '-Infinity',
    '١٢', // non-ASCII digits
    '1_000',
  ])('rejects the string %j with invalid_decimal', (input) => {
    expect(() => toDecimal(input)).toThrow(MoneyError)
    try {
      toDecimal(input)
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_decimal',
        message: 'Neispravan decimalni broj.',
      })
    }
  })

  it('accepts safe integers and Decimal instances', () => {
    expect(toDecimal(0).toString()).toBe('0')
    expect(toDecimal(-3).toString()).toBe('-3')
    expect(toDecimal(Number.MAX_SAFE_INTEGER).toString()).toBe('9007199254740991')
    expect(toDecimal(new Decimal('0.125')).toString()).toBe('0.125')
    expect(toDecimal(new DecimalBase('0.125')).toString()).toBe('0.125')
  })

  it.each([1.5, -0.5, 0.1 + 0.2, 2 ** 53, -(2 ** 53), 1e21])(
    'rejects the JS number %s (fractional or not a safe integer) with invalid_decimal',
    (value) => {
      expect(() => toDecimal(value)).toThrow(MoneyError)
      expect(() => toDecimal(value)).toThrow(expect.objectContaining({ code: 'invalid_decimal' }))
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects the number %s',
    (value) => {
      expect(() => toDecimal(value)).toThrow(MoneyError)
    },
  )

  it('rejects a non-finite Decimal instance', () => {
    expect(() => toDecimal(new Decimal(Number.NaN))).toThrow(MoneyError)
    expect(() => toDecimal(new Decimal(Number.POSITIVE_INFINITY))).toThrow(MoneyError)
  })
})

describe('MoneyError', () => {
  it('is an Error with a name, a code and a message', () => {
    const error = new MoneyError('amount_too_large', 'Iznos stavke je prevelik.')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(MoneyError)
    expect(error.name).toBe('MoneyError')
    expect(error.code).toBe('amount_too_large')
    expect(error.message).toBe('Iznos stavke je prevelik.')
  })
})
