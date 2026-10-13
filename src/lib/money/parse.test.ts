import { describe, expect, it } from 'vitest'
import { createRng, randomInt, testSeed } from '../../../tests/helpers/fake'
import { formatCents, formatDecimal } from './format'
import { parseAmountToCents, parseDecimal, type ParseErrorCode, type ParseResult } from './parse'

// Whitespace variants are written as escapes so the tests cannot be changed by an editor or
// formatter that normalizes exotic spaces.
const NBSP = ' '
const NARROW_NBSP = ' '
const MINUS = '−'

const ok = <T>(value: T) => ({ ok: true, value })

function expectFailure(result: ParseResult<unknown>, code: ParseErrorCode) {
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.code).toBe(code)
    expect(result.error).not.toBe('')
  }
}

describe('parseAmountToCents: accepted input', () => {
  it.each([
    // Plan table
    ['12,50', 1250],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1 234,56', 123456],
    [`1${NBSP}234,56`, 123456],
    [`1${NARROW_NBSP}234,56`, 123456],
    ['12.5', 1250],
    ['12.50', 1250],
    ['1.234.567', 123456700],
    ['1.234.567,89', 123456789],
    ['0', 0],
    ['0,00', 0],
    ['0,01', 1],
    ['+5', 500],
    ['999.999.999,99', 99_999_999_999],
    // Fewer than 2 decimals, and one cent either side of a euro
    ['12,5', 1250],
    ['12,05', 1205],
    ['0,1', 10],
    ['0,10', 10],
    ['0,99', 99],
    ['1,01', 101],
    ['5', 500],
    ['100', 10000],
    // English-style decimal points: one dot and 1-2 digits after it
    ['0.5', 50],
    ['0.05', 5],
    ['1234.5', 123450],
    ['1234.56', 123456],
    ['100.5', 10050],
    // Grouping variants
    ['1 234 567,89', 123456789],
    ['12 345', 1234500],
    ['1 234.56', 123456], // spaces group thousands, so the dot is a decimal point
    [`1${NBSP}234${NARROW_NBSP}567,89`, 123456789],
    ['999.999.999', 99_999_999_900],
    ['123.456.789,01', 12345678901],
    // Sign and surrounding whitespace
    ['+5,25', 525],
    ['  12,50  ', 1250],
    ['\t12,50\n', 1250],
    [`${NBSP}12,50${NBSP}`, 1250],
    [`${' '.repeat(50)}5,00${' '.repeat(50)}`, 500], // the length limit applies after trimming
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseAmountToCents(input)).toEqual(ok(cents))
  })

  it('returns exact integers for cents above 2^31 without any rounding', () => {
    expect(parseAmountToCents('21.474.836,48')).toEqual(ok(2_147_483_648))
    expect(parseAmountToCents('90.071.992,55')).toEqual(ok(9_007_199_255))
  })
})

describe('parseAmountToCents: rejected input', () => {
  it.each<[string, ParseErrorCode]>([
    // Plan table
    ['1.234', 'ambiguous'],
    ['0,125', 'scale'],
    ['-5,00', 'negative'],
    [`${MINUS}5,00`, 'negative'],
    ['1,234.56', 'decimal_separator'],
    ['12,5,0', 'malformed'],
    ['1..2', 'malformed'],
    ['1.23.4', 'malformed'],
    [',5', 'malformed'],
    ['5,', 'malformed'],
    ['', 'required'],
    ['   ', 'required'],
    ['abc', 'malformed'],
    ['12€', 'malformed'],
    ['€12', 'malformed'],
    ['1e3', 'malformed'],
    ['0x10', 'malformed'],
    ['١٢', 'malformed'],
    ['1.000.000.000,00', 'too_large'],
    // The ambiguous thousands pattern: one dot, 1-3 leading digits (no leading zero), 3 digits
    ['12.000', 'ambiguous'],
    ['100.000', 'ambiguous'],
    ['999.999', 'ambiguous'],
    ['+1.234', 'ambiguous'],
    // Decimal digits are counted as typed (developer decision 2): trailing zeros do not help
    ['12,500', 'scale'],
    ['12,000', 'scale'],
    ['12,505', 'scale'],
    ['0.123', 'scale'], // leading 0 cannot be a thousands group, so it is a 3-decimal number
    ['1234.567', 'scale'],
    ['1234.000', 'scale'],
    ['1 234.567', 'scale'],
    // Grouping is strict (developer decision 4)
    ['1234 567', 'malformed'],
    ['0.123.456', 'malformed'],
    ['1.234 567', 'malformed'],
    ['1.234 567,89', 'malformed'],
    ['1 234.567.890', 'malformed'],
    ['01.234,56', 'malformed'],
    ['0 123', 'malformed'],
    ['1 23', 'malformed'],
    ['12 3456', 'malformed'],
    ['1.234.56', 'malformed'],
    ['1.23,45', 'malformed'],
    ['1234.567.890', 'malformed'],
    ['5 ,00', 'malformed'],
    ['5, 00', 'malformed'],
    ['12,5 0', 'malformed'],
    // Separators and signs in the wrong place
    [',', 'malformed'],
    ['.', 'malformed'],
    ['..', 'malformed'],
    ['.5', 'malformed'],
    ['5.', 'malformed'],
    ['1.234.', 'malformed'],
    ['.1.234', 'malformed'],
    ['1,2,3', 'malformed'],
    ['-', 'malformed'],
    ['+', 'malformed'],
    [MINUS, 'malformed'],
    ['--5', 'malformed'],
    ['+-5', 'malformed'],
    ['-+5', 'malformed'],
    ['- 5', 'malformed'],
    ['5-', 'malformed'],
    ['(5,00)', 'malformed'],
    // Not a number
    ['5 €', 'malformed'],
    ['EUR 5', 'malformed'],
    ['1,5%', 'malformed'],
    ['NaN', 'malformed'],
    ['Infinity', 'malformed'],
    ['1_000', 'malformed'],
    ['1e-3', 'malformed'],
    ['0b1', 'malformed'],
    ['1\n2', 'malformed'],
    ['1\t2', 'malformed'],
    ['１２', 'malformed'], // full-width digits
    ['٣,٥', 'malformed'],
    ['1,5​', 'malformed'], // zero-width space is not trimmed
    // Too large
    ['1000000000', 'too_large'],
    ['1.000.000.000', 'too_large'],
    ['99999999999', 'too_large'],
    ['1.234.567.890,12', 'too_large'],
    ['999.999.999,995', 'scale'], // scale is checked before size
    // Negative is its own error, even for zero (developer decision 5)
    ['-0', 'negative'],
    ['-0,00', 'negative'],
    ['-1.234,56', 'negative'],
    ['-12.5', 'negative'],
    ['-1.000.000.000,00', 'negative'], // sign is checked before size
  ])('rejects %j with code %s', (input, code) => {
    expectFailure(parseAmountToCents(input), code)
  })

  it('reports required for null, undefined and every kind of blank', () => {
    for (const input of [null, undefined, '', ' ', '\t', '\n', NBSP, NARROW_NBSP, ' \t\r\n ']) {
      expectFailure(parseAmountToCents(input), 'required')
    }
  })

  it('limits the input to 40 characters after trimming (developer decision 6)', () => {
    // 40 characters still get parsed (and fail for another reason), 41 are rejected up front.
    expectFailure(parseAmountToCents(`0,${'0'.repeat(38)}`), 'scale')
    expectFailure(parseAmountToCents(`0,${'0'.repeat(39)}`), 'malformed')
    expectFailure(parseAmountToCents('1'.repeat(41)), 'malformed')
    expectFailure(parseAmountToCents(`-${'1'.repeat(41)}`, { allowNegative: true }), 'malformed')
    expectFailure(parseAmountToCents('1'.repeat(40)), 'too_large')
  })

  it('does not throw on odd but string-typed input', () => {
    for (const input of [
      '\0',
      '\u0000 5',
      'null',
      'undefined',
      '{}',
      '[]',
      '5\u0000',
      '💶',
      '5💶',
    ]) {
      expect(() => parseAmountToCents(input)).not.toThrow()
      expectFailure(parseAmountToCents(input), 'malformed')
    }
  })

  it('returns the exact failure shape', () => {
    expect(parseAmountToCents('abc')).toEqual({
      ok: false,
      code: 'malformed',
      error: 'Neispravan iznos.',
    })
  })
})

describe('parseAmountToCents: options', () => {
  it.each([1e20, 2 ** 53, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws for the invalid max %s',
    (max) => {
      expect(() => parseAmountToCents('1', { max })).toThrow(RangeError)
    },
  )

  it('accepts the largest safe max and rejects an amount above it', () => {
    expect(parseAmountToCents('90.071.992.547.409,91', { max: Number.MAX_SAFE_INTEGER })).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    })
    expect(parseAmountToCents('99999999999999999', { max: Number.MAX_SAFE_INTEGER })).toMatchObject(
      { ok: false, code: 'too_large' },
    )
  })

  it('handles negatives when allowed, including the U+2212 minus', () => {
    expect(parseAmountToCents('-5,00', { allowNegative: true })).toEqual(ok(-500))
    expect(parseAmountToCents(`${MINUS}5,00`, { allowNegative: true })).toEqual(ok(-500))
    expect(parseAmountToCents('-0,01', { allowNegative: true })).toEqual(ok(-1))
    expect(parseAmountToCents('-1.234,56', { allowNegative: true })).toEqual(ok(-123456))
    expect(parseAmountToCents('-999.999.999,99', { allowNegative: true })).toEqual(
      ok(-99_999_999_999),
    )
    expect(parseAmountToCents('+5', { allowNegative: true })).toEqual(ok(500))
  })

  it('returns 0, never -0, for negative zero when negatives are allowed (decision 5)', () => {
    for (const input of ['-0', '-0,00', '-0.00', `${MINUS}0`]) {
      const result = parseAmountToCents(input, { allowNegative: true })
      expect(result).toEqual(ok(0))
      expect(Object.is(result.ok && result.value, 0)).toBe(true)
    }
  })

  it('still rejects malformed and ambiguous input when negatives are allowed', () => {
    const opts = { allowNegative: true }
    expectFailure(parseAmountToCents('-1.234', opts), 'ambiguous')
    expectFailure(parseAmountToCents('-0,125', opts), 'scale')
    expectFailure(parseAmountToCents('-1,234.56', opts), 'decimal_separator')
    expectFailure(parseAmountToCents('--5', opts), 'malformed')
    expectFailure(parseAmountToCents('-1.000.000.000,00', opts), 'too_large')
  })

  it('applies a custom max to the absolute value', () => {
    expect(parseAmountToCents('10,00', { max: 1000 })).toEqual(ok(1000))
    expectFailure(parseAmountToCents('10,01', { max: 1000 }), 'too_large')
    expect(parseAmountToCents('-10,00', { max: 1000, allowNegative: true })).toEqual(ok(-1000))
    expectFailure(parseAmountToCents('-10,01', { max: 1000, allowNegative: true }), 'too_large')
    expect(parseAmountToCents('0', { max: 0 })).toEqual(ok(0))
    expectFailure(parseAmountToCents('0,01', { max: 0 }), 'too_large')
  })

  it('has an inclusive default max of 99_999_999_999 cents', () => {
    expect(parseAmountToCents('999.999.999,99')).toEqual(ok(99_999_999_999))
    expectFailure(parseAmountToCents('1.000.000.000,00'), 'too_large')
  })

  it('returns null for an empty optional field, and still validates a filled one', () => {
    for (const input of ['', '   ', NBSP, null, undefined]) {
      expect(parseAmountToCents(input, { optional: true })).toEqual(ok(null))
    }
    expect(parseAmountToCents('12,50', { optional: true })).toEqual(ok(1250))
    expect(parseAmountToCents('0', { optional: true })).toEqual(ok(0))
    expectFailure(parseAmountToCents('abc', { optional: true }), 'malformed')
    expectFailure(parseAmountToCents('1.234', { optional: true }), 'ambiguous')
  })

  it('uses Croatian messages', () => {
    expect(parseAmountToCents('1.234')).toMatchObject({
      error: 'Nejasan iznos. Upišite npr. 1.234,00 ili 1,23.',
    })
    expect(parseAmountToCents('0,125')).toMatchObject({ error: 'Najviše 2 decimale.' })
    expect(parseAmountToCents('1,234.56')).toMatchObject({ error: 'Za decimale koristite zarez.' })
    expect(parseAmountToCents('')).toMatchObject({ error: 'Obavezno polje.' })
    expect(parseAmountToCents('abc')).toMatchObject({ error: 'Neispravan iznos.' })
    expect(parseAmountToCents('-1')).toMatchObject({ error: 'Iznos ne smije biti negativan.' })
    expect(parseAmountToCents('1.000.000.000,00')).toMatchObject({ error: 'Iznos je prevelik.' })
  })
})

describe('parseDecimal: accepted input', () => {
  it.each([
    // Plan table
    ['0,125', '0.125'],
    ['0.125', '0.125'],
    ['12,50', '12.5'],
    ['1.234,5', '1234.5'],
    ['1,123456', '1.123456'],
    ['0', '0'],
    ['007', '7'],
    // Canonical output (developer decision 3): no trailing zeros, no leading zeros, never "-0"
    ['12,00', '12'],
    ['10,0', '10'],
    ['100', '100'],
    ['0,10', '0.1'],
    ['0,000000', '0'],
    ['000', '0'],
    ['1.000.000', '1000000'],
    ['0,000001', '0.000001'],
    ['12,500', '12.5'], // scale is not an amount issue here: 3 <= maxScale
    ['1,234', '1.234'], // a comma is always a decimal separator
    ['1234.567', '1234.567'], // not a thousands pattern: 4 leading digits
    ['1 234.567', '1234.567'],
    ['1.5', '1.5'],
    ['100.5', '100.5'],
    ['1 234,56', '1234.56'],
    [`1${NBSP}234,567`, '1234.567'],
    ['+2,5', '2.5'],
    [' 2,5 ', '2.5'],
    ['999.999.999,999999', '999999999.999999'],
    // Long, but within the 40-character limit, and exact
    ['1'.repeat(40), '1'.repeat(40)],
    [`${'9'.repeat(33)},999999`, `${'9'.repeat(33)}.999999`],
  ])('parses %j as %j', (input, value) => {
    expect(parseDecimal(input)).toEqual(ok(value))
  })

  it('accepts a leading "0." because it cannot be a thousands group', () => {
    expect(parseDecimal('0.123')).toEqual(ok('0.123'))
    expect(parseDecimal('0.999')).toEqual(ok('0.999'))
  })

  it('respects maxScale', () => {
    expect(parseDecimal('1,2', { maxScale: 1 })).toEqual(ok('1.2'))
    expect(parseDecimal('5', { maxScale: 0 })).toEqual(ok('5'))
    expect(parseDecimal('1,1234567', { maxScale: 7 })).toEqual(ok('1.1234567'))
    expect(parseDecimal('0,12', { maxScale: 2 })).toEqual(ok('0.12'))
  })
})

describe('parseDecimal: rejected input', () => {
  it.each<[string, ParseErrorCode]>([
    ['1,1234567', 'scale'],
    ['0.1234567', 'scale'],
    ['1.234', 'ambiguous'],
    ['12.000', 'ambiguous'],
    ['100.000', 'ambiguous'],
    ['1.234,5.6', 'decimal_separator'],
    ['1,234.56', 'decimal_separator'],
    ['-1', 'negative'],
    ['-0', 'negative'],
    ['-0,00', 'negative'],
    [`${MINUS}1`, 'negative'],
    ['', 'required'],
    ['  ', 'required'],
    ['abc', 'malformed'],
    ['1e3', 'malformed'],
    ['12€', 'malformed'],
    ['1234 567', 'malformed'],
    ['0.123.456', 'malformed'],
    ['1.234 567', 'malformed'],
    [',5', 'malformed'],
    ['5,', 'malformed'],
    ['.5', 'malformed'],
    ['1,2,3', 'malformed'],
    ['1..2', 'malformed'],
    ['١٢', 'malformed'],
    ['1'.repeat(41), 'malformed'],
  ])('rejects %j with code %s', (input, code) => {
    expectFailure(parseDecimal(input), code)
  })

  it('counts decimals as typed against maxScale (developer decision 2)', () => {
    expectFailure(parseDecimal('1,23', { maxScale: 1 }), 'scale')
    expectFailure(parseDecimal('5,0', { maxScale: 0 }), 'scale')
    expectFailure(parseDecimal('5,5', { maxScale: 0 }), 'scale')
    expectFailure(parseDecimal('1,2000000', { maxScale: 6 }), 'scale')
  })

  it('reports required for null and undefined', () => {
    expectFailure(parseDecimal(null), 'required')
    expectFailure(parseDecimal(undefined), 'required')
  })

  it('gives scale messages with correct Croatian number agreement', () => {
    expect(parseDecimal('1,1234567')).toMatchObject({ error: 'Najviše 6 decimala.' })
    expect(parseDecimal('1,23', { maxScale: 1 })).toMatchObject({ error: 'Najviše 1 decimala.' })
    expect(parseDecimal('1,234', { maxScale: 2 })).toMatchObject({ error: 'Najviše 2 decimale.' })
    expect(parseDecimal('1,2345', { maxScale: 3 })).toMatchObject({ error: 'Najviše 3 decimale.' })
    expect(parseDecimal('1,23456', { maxScale: 4 })).toMatchObject({ error: 'Najviše 4 decimale.' })
    expect(parseDecimal('1,234567', { maxScale: 5 })).toMatchObject({
      error: 'Najviše 5 decimala.',
    })
    expect(parseDecimal('1,5', { maxScale: 0 })).toMatchObject({
      error: 'Decimale nisu dopuštene.',
    })
  })
})

describe('parseDecimal: options', () => {
  it('handles negatives when allowed', () => {
    expect(parseDecimal('-1,5', { allowNegative: true })).toEqual(ok('-1.5'))
    expect(parseDecimal(`${MINUS}1,5`, { allowNegative: true })).toEqual(ok('-1.5'))
    expect(parseDecimal('-0,125', { allowNegative: true })).toEqual(ok('-0.125'))
    expect(parseDecimal('-1.234,5', { allowNegative: true })).toEqual(ok('-1234.5'))
    expect(parseDecimal('+1,5', { allowNegative: true })).toEqual(ok('1.5'))
    expectFailure(parseDecimal('-1.234', { allowNegative: true }), 'ambiguous')
  })

  it('never returns "-0"', () => {
    for (const input of ['-0', '-0,00', '-0,000000', '-000', '-0.0']) {
      expect(parseDecimal(input, { allowNegative: true })).toEqual(ok('0'))
    }
    expect(parseDecimal('-1,5', { allowNegative: true })).toEqual(ok('-1.5'))
  })

  it('returns null for an empty optional field, and still validates a filled one', () => {
    for (const input of ['', '   ', null, undefined]) {
      expect(parseDecimal(input, { optional: true })).toEqual(ok(null))
    }
    expect(parseDecimal('0,5', { optional: true })).toEqual(ok('0.5'))
    expectFailure(parseDecimal('abc', { optional: true }), 'malformed')
  })
})

// ---------------------------------------------------------------------------------------------
// Property-style checks with plain loops. The seed is in every failure message.

const ITERATIONS = 1000

/** Groups an integer string in threes from the right: "1234567" -> ["1", "234", "567"]. */
function groupsOfThree(int: string): string[] {
  const groups: string[] = []
  for (let end = int.length; end > 0; end -= 3) groups.unshift(int.slice(Math.max(0, end - 3), end))
  return groups
}

describe('property: every notation of the same amount parses to the same cents', () => {
  it('plain, dot-grouped, space-grouped and English notations agree', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < ITERATIONS; i++) {
      // Spread the amounts over many magnitudes, up to the default max.
      const digits = randomInt(rng, 1, 12)
      let cents = 0
      for (let d = 0; d < digits; d++) cents = cents * 10 + randomInt(rng, 0, 10)
      cents = Math.min(cents, 99_999_999_999)

      const padded = String(cents).padStart(3, '0')
      const int = padded.slice(0, -2)
      const frac = padded.slice(-2)
      const groups = groupsOfThree(int)
      const label = `seed ${seed}, iteration ${i}, cents ${cents}`

      // The same amount without trailing zeros: 12,50 -> 12,5 and 12,00 -> 12.
      const shortest =
        frac === '00' ? int : frac.endsWith('0') ? `${int},${frac.charAt(0)}` : `${int},${frac}`
      const variants = [
        `${int},${frac}`,
        `${groups.join('.')},${frac}`,
        `${groups.join(' ')},${frac}`,
        `${groups.join(NBSP)},${frac}`,
        `${int}.${frac}`, // English style: exactly 2 decimals, never ambiguous
        shortest,
      ]
      for (const variant of variants) {
        expect(parseAmountToCents(variant), `${label}, input ${JSON.stringify(variant)}`).toEqual(
          ok(cents),
        )
      }
    }
  })

  it('a negated input parses to the negated cents when allowed, and fails otherwise', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < ITERATIONS; i++) {
      const cents = randomInt(rng, 1, 2_000_000_000)
      const padded = String(cents).padStart(3, '0')
      const input = `${padded.slice(0, -2)},${padded.slice(-2)}`
      const label = `seed ${seed}, input ${input}`
      expect(parseAmountToCents(`-${input}`, { allowNegative: true }), label).toEqual(ok(-cents))
      expect(parseAmountToCents(`${MINUS}${input}`, { allowNegative: true }), label).toEqual(
        ok(-cents),
      )
      expectFailure(parseAmountToCents(`-${input}`), 'negative')
    }
  })
})

describe('property: parse -> format -> parse is stable', () => {
  // The UI never does this in production (the submitted value is the user's raw string); it guards
  // that display formatting stays parseable.
  const stripCurrency = (shown: string) => shown.replace(/[   ]?€$/, '')

  it('cents survive formatCents -> parseAmountToCents, negatives included', () => {
    const rng = createRng()
    const seed = testSeed()
    const edge = [0, 1, 99, 100, 101, 999, 1000, 99_999, 100_000, 123_456, 99_999_999_999]
    for (let i = 0; i < ITERATIONS + edge.length; i++) {
      const cents =
        i < edge.length
          ? (edge[i] ?? 0)
          : randomInt(rng, 0, 1000) * randomInt(rng, 0, 100_000) + randomInt(rng, 0, 100)
      for (const value of cents === 0 ? [0] : [cents, -cents]) {
        const shown = stripCurrency(formatCents(value))
        const label = `seed ${seed}, cents ${value}, shown ${JSON.stringify(shown)}`
        const first = parseAmountToCents(shown, { allowNegative: true })
        expect(first, label).toEqual(ok(value))
        // And once more: stable after a second round.
        const again = parseAmountToCents(stripCurrency(formatCents(first.ok ? first.value : 0)), {
          allowNegative: true,
        })
        expect(again, label).toEqual(first)
      }
    }
  })

  it('canonical decimals survive formatDecimal -> parseDecimal, negatives included', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < ITERATIONS; i++) {
      const intLength = randomInt(rng, 1, 14)
      let int = String(randomInt(rng, 1, 10))
      for (let d = 1; d < intLength; d++) int += String(randomInt(rng, 0, 10))
      if (rng() < 0.15) int = '0'
      const scale = randomInt(rng, 0, 7)
      let frac = ''
      for (let d = 0; d < scale; d++) frac += String(randomInt(rng, 0, 10))
      frac = frac.replace(/0+$/, '') // canonical: no trailing zeros
      const canonical = frac === '' ? int : `${int}.${frac}`

      for (const value of canonical === '0' ? ['0'] : [canonical, `-${canonical}`]) {
        const shown = stripCurrency(formatDecimal(value))
        const label = `seed ${seed}, value ${value}, shown ${JSON.stringify(shown)}`
        expect(parseDecimal(shown, { allowNegative: true }), label).toEqual(ok(value))
      }
      // A Croatian-notation input with a comma parses to the same canonical value.
      expect(parseDecimal(canonical.replace('.', ','))).toEqual(ok(canonical))
    }
  })

  it('parseDecimal is idempotent on its own canonical output', () => {
    for (const input of ['12,00', '0,125', '1.234,5', '007', '0,000001', '999.999.999,999999']) {
      const first = parseDecimal(input)
      expect(first.ok).toBe(true)
      if (first.ok) {
        // Re-feed with the decimal point turned into a comma (a canonical "1234.5" would be a
        // different notation, and "1.234" would be ambiguous).
        expect(parseDecimal(first.value.replace('.', ','))).toEqual(first)
      }
    }
  })
})
