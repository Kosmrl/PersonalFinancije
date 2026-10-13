import { describe, expect, it } from 'vitest'
import { createRng, randomInt, testSeed, type Rng } from '../../../tests/helpers/fake'
import { MoneyError, type MoneyErrorCode } from './decimal'
import { lineTotalCents, type LineTotalInput } from './line-total'

function expectMoneyError(input: LineTotalInput, code: MoneyErrorCode, message?: string) {
  let thrown: unknown
  try {
    lineTotalCents(input)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(MoneyError)
  expect(thrown).toMatchObject({ code })
  if (message !== undefined) expect(thrown).toMatchObject({ message })
}

describe('lineTotalCents: plan table', () => {
  it.each([
    ['1 x 0.125', { quantity: '1', unitPrice: '0.125' }, 13],
    ['3 x 0.333333', { quantity: '3', unitPrice: '0.333333' }, 100],
    ['1.5 x 33.33', { quantity: '1.5', unitPrice: '33.33' }, 5000],
    ['-1.5 x 33.33', { quantity: '-1.5', unitPrice: '33.33' }, -5000],
    ['1 x 0.05, 10% off', { quantity: '1', unitPrice: '0.05', discountPercent: '10' }, 5],
    ['0 x 99.99', { quantity: '0', unitPrice: '99.99' }, 0],
    ['2 x 0', { quantity: '2', unitPrice: '0' }, 0],
    ['1 x 0.004999', { quantity: '1', unitPrice: '0.004999' }, 0],
    ['1 x 0.005', { quantity: '1', unitPrice: '0.005' }, 1],
    ['1 x 999999999.999999', { quantity: '1', unitPrice: '999999999.999999' }, 100_000_000_000],
  ])('%s', (_name, input, cents) => {
    expect(lineTotalCents(input)).toBe(cents)
  })

  it('throws an explicit error above Number.MAX_SAFE_INTEGER cents', () => {
    const call = () => lineTotalCents({ quantity: '999999999', unitPrice: '999999999.999999' })
    expect(call).toThrow(MoneyError)
    expect(call).toThrow('Iznos stavke je prevelik.')
    expectMoneyError(
      { quantity: '999999999', unitPrice: '999999999.999999' },
      'amount_too_large',
      'Iznos stavke je prevelik.',
    )
  })
})

describe('lineTotalCents: rounding (half up, ties away from zero, once)', () => {
  it.each([
    // Exactly half a cent rounds away from zero, for both signs
    ['0.005', '1', 1],
    ['0.015', '1', 2],
    ['0.025', '1', 3],
    ['0.125', '1', 13],
    ['0.125', '-1', -13],
    ['-0.125', '1', -13],
    ['-0.125', '-1', 13],
    ['0.005', '-1', -1],
    ['49.995', '1', 5000],
    ['49.995', '-1', -5000],
    // Just below half
    ['0.004999', '1', 0],
    ['0.014999', '1', 1],
    ['0.124999', '1', 12],
    ['0.124999', '-1', -12],
    // Just above half
    ['0.005001', '1', 1],
    ['0.125001', '1', 13],
    // Exact cents stay exact
    ['0.01', '1', 1],
    ['0.01', '-1', -1],
    ['19.99', '1', 1999],
    ['19.99', '3', 5997],
    ['0.1', '3', 30],
    ['0.07', '100', 700],
  ])('unit price %s x quantity %s = %i cents', (unitPrice, quantity, cents) => {
    expect(lineTotalCents({ quantity, unitPrice })).toBe(cents)
  })

  it('is not fooled by binary floating point', () => {
    // Naive Math.round(1.005 * 100) is 100 because 1.005 * 100 = 100.49999999999999.
    expect(lineTotalCents({ quantity: '1', unitPrice: '1.005' })).toBe(101)
    expect(lineTotalCents({ quantity: '1', unitPrice: '8.325' })).toBe(833)
    expect(lineTotalCents({ quantity: '1', unitPrice: '1.255' })).toBe(126)
    expect(lineTotalCents({ quantity: '3', unitPrice: '0.1' })).toBe(30)
    expect(lineTotalCents({ quantity: '0.1', unitPrice: '3' })).toBe(30)
    expect(lineTotalCents({ quantity: '1.1', unitPrice: '1.1' })).toBe(121)
  })

  it('rounds exactly once, never an intermediate product', () => {
    // 3 x 0.335 x 50% = 0.5025 -> 50. Rounding the product (1.005 -> 1.01) before the discount
    // would give 0.505 -> 51; rounding the unit price first (0.335 -> 0.34) gives 51 as well.
    expect(lineTotalCents({ quantity: '3', unitPrice: '0.335', discountPercent: '50' })).toBe(50)
    // 0.333 x 3 = 0.999 -> 100. Rounding 0.333 to 33 cents first would give 99.
    expect(lineTotalCents({ quantity: '3', unitPrice: '0.333' })).toBe(100)
    // 1/3 as a 6-decimal price: 3 x 0.333333 = 0.999999 -> 100 (rounding the unit price to cents
    // first would give 99).
    expect(lineTotalCents({ quantity: '3', unitPrice: '0.333333' })).toBe(100)
    // 7 x 0.145 = 1.015 -> 102; rounding 0.145 -> 0.15 first would give 105.
    expect(lineTotalCents({ quantity: '7', unitPrice: '0.145' })).toBe(102)
  })

  it('is symmetric around zero', () => {
    for (const [quantity, unitPrice] of [
      ['1.5', '33.33'],
      ['1', '0.125'],
      ['3', '0.333333'],
      ['0.001', '1000'],
      ['7', '0.145'],
      ['2.5', '0.005'],
    ] as const) {
      const positive = lineTotalCents({ quantity, unitPrice })
      expect(lineTotalCents({ quantity: `-${quantity}`, unitPrice })).toBe(-positive)
      expect(lineTotalCents({ quantity, unitPrice: `-${unitPrice}` })).toBe(-positive)
      expect(lineTotalCents({ quantity: `-${quantity}`, unitPrice: `-${unitPrice}` })).toBe(
        positive,
      )
    }
  })

  it('handles very small and very large quantities and prices', () => {
    expect(lineTotalCents({ quantity: '0.000001', unitPrice: '0.000001' })).toBe(0)
    expect(lineTotalCents({ quantity: '0.001', unitPrice: '1000' })).toBe(100)
    expect(lineTotalCents({ quantity: '1000000', unitPrice: '999.999999' })).toBe(99_999_999_900)
    expect(lineTotalCents({ quantity: '0.000001', unitPrice: '999999999.999999' })).toBe(100_000)
    expect(lineTotalCents({ quantity: '123456789', unitPrice: '0.01' })).toBe(123_456_789)
  })

  it('returns an integer for every kind of input', () => {
    for (const [quantity, unitPrice] of [
      ['1.5', '33.33'],
      ['0.333333', '0.333333'],
      ['99999.999999', '999.999999'],
    ] as const) {
      expect(Number.isInteger(lineTotalCents({ quantity, unitPrice }))).toBe(true)
    }
  })
})

describe('lineTotalCents: zero and negative zero', () => {
  it('never returns negative zero', () => {
    expect(Object.is(lineTotalCents({ quantity: '-1', unitPrice: '0.004' }), 0)).toBe(true)
    expect(Object.is(lineTotalCents({ quantity: '1', unitPrice: '-0.004' }), 0)).toBe(true)
    expect(Object.is(lineTotalCents({ quantity: '-0', unitPrice: '5' }), 0)).toBe(true)
    expect(Object.is(lineTotalCents({ quantity: '-5', unitPrice: '0' }), 0)).toBe(true)
    expect(
      Object.is(lineTotalCents({ quantity: '-1', unitPrice: '1', discountPercent: '100' }), 0),
    ).toBe(true)
  })

  it('is 0 when quantity or price is 0, with or without discount', () => {
    expect(lineTotalCents({ quantity: '0', unitPrice: '0' })).toBe(0)
    expect(lineTotalCents({ quantity: '0', unitPrice: '99.99', discountPercent: '50' })).toBe(0)
    expect(lineTotalCents({ quantity: '5', unitPrice: '0', discountPercent: '50' })).toBe(0)
  })
})

describe('lineTotalCents: discount', () => {
  it.each([
    ['0', 10_000],
    ['0.00', 10_000],
    ['0.01', 9_999],
    ['10', 9_000],
    ['12.5', 8_750],
    ['12.50', 8_750],
    ['33.33', 6_667],
    ['50', 5_000],
    ['99.99', 1],
    ['100', 0],
    ['100.00', 0],
  ])('%s%% off 100.00 = %i cents', (discountPercent, cents) => {
    expect(lineTotalCents({ quantity: '1', unitPrice: '100', discountPercent })).toBe(cents)
  })

  it('treats an omitted, undefined and zero discount the same', () => {
    const base = { quantity: '3', unitPrice: '0.333333' }
    const expected = lineTotalCents(base)
    expect(lineTotalCents({ ...base, discountPercent: undefined })).toBe(expected)
    expect(lineTotalCents({ ...base, discountPercent: '0' })).toBe(expected)
    expect(lineTotalCents({ ...base, discountPercent: 0 })).toBe(expected)
  })

  it('rounds the discounted line once, half away from zero', () => {
    // 0.05 x 90% = 0.045 -> 5 cents (4.5 rounds up); -0.05 x 90% -> -5.
    expect(lineTotalCents({ quantity: '1', unitPrice: '0.05', discountPercent: '10' })).toBe(5)
    expect(lineTotalCents({ quantity: '-1', unitPrice: '0.05', discountPercent: '10' })).toBe(-5)
    // 10.01 x 67% = 6.7067 -> 671
    expect(lineTotalCents({ quantity: '1', unitPrice: '10.01', discountPercent: '33' })).toBe(671)
    // 0.01 x 50% = 0.005 -> 1 cent (not 0)
    expect(lineTotalCents({ quantity: '1', unitPrice: '0.01', discountPercent: '50' })).toBe(1)
  })

  it('accepts a number for the discount', () => {
    expect(lineTotalCents({ quantity: '1', unitPrice: '100', discountPercent: 25 })).toBe(7_500)
  })

  it.each(['100.01', '101', '1000', '-1', '-0.01', '10.005', '0.001', '33.333', '100.001'])(
    'rejects the discount %s with invalid_discount',
    (discountPercent) => {
      expectMoneyError(
        { quantity: '1', unitPrice: '1', discountPercent },
        'invalid_discount',
        'Popust mora biti između 0 i 100 %, najviše 2 decimale.',
      )
    },
  )

  it('rejects an invalid discount even when the line itself is zero', () => {
    expectMoneyError({ quantity: '0', unitPrice: '0', discountPercent: '101' }, 'invalid_discount')
  })

  it.each(['abc', '', '10%', '1e1', ' 10', '10,5'])(
    'rejects the unparseable discount %j with invalid_decimal',
    (discountPercent) => {
      expectMoneyError({ quantity: '1', unitPrice: '1', discountPercent }, 'invalid_decimal')
    },
  )

  it('rejects a non-finite numeric discount', () => {
    expectMoneyError(
      { quantity: '1', unitPrice: '1', discountPercent: Number.NaN },
      'invalid_decimal',
    )
  })
})

describe('lineTotalCents: range', () => {
  const MAX_SAFE_CENTS_PRICE = '90071992547409.91' // x 100 = 9_007_199_254_740_991

  it('returns the largest safe integer, and refuses one cent more, for both signs', () => {
    expect(lineTotalCents({ quantity: '1', unitPrice: MAX_SAFE_CENTS_PRICE })).toBe(
      Number.MAX_SAFE_INTEGER,
    )
    expect(lineTotalCents({ quantity: '-1', unitPrice: MAX_SAFE_CENTS_PRICE })).toBe(
      -Number.MAX_SAFE_INTEGER,
    )
    expectMoneyError({ quantity: '1', unitPrice: '90071992547409.92' }, 'amount_too_large')
    expectMoneyError({ quantity: '-1', unitPrice: '90071992547409.92' }, 'amount_too_large')
    expectMoneyError({ quantity: '1', unitPrice: '-90071992547409.92' }, 'amount_too_large')
  })

  it('checks the rounded value: a half cent over the limit still fails', () => {
    // 90071992547409.915 -> 9007199254740991.5 -> rounds to ...992, which is above the limit.
    expectMoneyError({ quantity: '1', unitPrice: '90071992547409.915' }, 'amount_too_large')
    // 90071992547409.914 -> ...991.4 -> ...991, still fine.
    expect(lineTotalCents({ quantity: '1', unitPrice: '90071992547409.914' })).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it('applies the discount before the range check', () => {
    expect(
      lineTotalCents({ quantity: '2', unitPrice: MAX_SAFE_CENTS_PRICE, discountPercent: '50' }),
    ).toBe(Number.MAX_SAFE_INTEGER)
    expectMoneyError(
      { quantity: '2', unitPrice: MAX_SAFE_CENTS_PRICE, discountPercent: '49' },
      'amount_too_large',
    )
  })

  it('refuses absurd magnitudes instead of returning garbage', () => {
    expectMoneyError({ quantity: '1'.repeat(30), unitPrice: '1'.repeat(30) }, 'amount_too_large')
    expectMoneyError(
      { quantity: '-1000000000000', unitPrice: '999999999.999999' },
      'amount_too_large',
    )
  })
})

describe('lineTotalCents: input handling', () => {
  it('accepts integer numbers and strings', () => {
    expect(lineTotalCents({ quantity: 3, unitPrice: '0.1' })).toBe(30)
    expect(lineTotalCents({ quantity: 2, unitPrice: '19.99' })).toBe(3998)
    expect(lineTotalCents({ quantity: 0, unitPrice: 5 })).toBe(0)
    expect(lineTotalCents({ quantity: 3, unitPrice: 5 })).toBe(1500)
  })

  it('rejects fractional JS numbers, which would carry float error into the total', () => {
    const message = 'Neispravan decimalni broj.'
    expectMoneyError({ quantity: 3, unitPrice: 0.1 }, 'invalid_decimal', message)
    expectMoneyError({ quantity: 1.5, unitPrice: '1' }, 'invalid_decimal', message)
    // 0.3 * 0.75 is 0.22499999999999998 as a float (22 cents), but exactly 0.225 (23 cents).
    expectMoneyError({ quantity: 1, unitPrice: 0.3 * 0.75 }, 'invalid_decimal', message)
    expect(lineTotalCents({ quantity: 1, unitPrice: '0.225' })).toBe(23)
  })

  it('rejects more than 6 decimal places or 30 significant digits with invalid_precision', () => {
    const message = 'Količina i cijena smiju imati najviše 6 decimala i 30 značajnih znamenki.'
    expect(lineTotalCents({ quantity: '1', unitPrice: '0.123456' })).toBe(12)
    expectMoneyError({ quantity: '1', unitPrice: '0.1234567' }, 'invalid_precision', message)
    expectMoneyError({ quantity: '0.1234567', unitPrice: '1' }, 'invalid_precision', message)
    expectMoneyError({ quantity: '1', unitPrice: '1'.repeat(31) }, 'invalid_precision', message)
    expectMoneyError({ quantity: '1'.repeat(31), unitPrice: '0' }, 'invalid_precision', message)
    // 30 digits passes the precision check; it is then too large for cents.
    expectMoneyError(
      { quantity: '1', unitPrice: '1'.repeat(30) },
      'amount_too_large',
      'Iznos stavke je prevelik.',
    )
    // Double-rounding case: 0.00499...95 rounded twice would give 1; rounded once it is 0.
    expectMoneyError(
      { quantity: '1', unitPrice: '0.004' + '9'.repeat(39) + '5' },
      'invalid_precision',
      message,
    )
  })

  it('keeps long inputs exact: no intermediate rounding of the product', () => {
    // 999999.999999999999 x 100 = 99999999.9999999999..., which rounds once to 100000000.
    expect(lineTotalCents({ quantity: '999999999999.999999', unitPrice: '0.000001' })).toBe(
      100_000_000,
    )
    expect(lineTotalCents({ quantity: '0.000001', unitPrice: '0.000001' })).toBe(0)
  })

  it.each(['', ' ', 'abc', '1,5', '1e3', '.5', '5.', ' 1', '1 ', 'NaN', 'Infinity', '--1', '0x10'])(
    'rejects the quantity %j with invalid_decimal',
    (quantity) => {
      expectMoneyError(
        { quantity, unitPrice: '1' },
        'invalid_decimal',
        'Neispravan decimalni broj.',
      )
    },
  )

  it.each(['', 'abc', '1,5', '1e3', '€5', 'NaN', 'Infinity'])(
    'rejects the unit price %j with invalid_decimal',
    (unitPrice) => {
      expectMoneyError({ quantity: '1', unitPrice }, 'invalid_decimal')
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects the numeric quantity %s',
    (quantity) => {
      expectMoneyError({ quantity, unitPrice: '1' }, 'invalid_decimal')
    },
  )

  it('does not mutate its input', () => {
    const input = Object.freeze({ quantity: '1.5', unitPrice: '33.33', discountPercent: '10' })
    expect(() => lineTotalCents(input)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------
// Property-style checks against an independent BigInt oracle (no decimal.js, no floats).

/** Renders an integer `n` scaled by 10^scale as a plain decimal string, e.g. (-125n, 3) -> "-0.125". */
function scaled(n: bigint, scale: number): string {
  const negative = n < 0n
  const digits = (negative ? -n : n).toString().padStart(scale + 1, '0')
  const int = digits.slice(0, digits.length - scale)
  const frac = digits.slice(digits.length - scale)
  return `${negative ? '-' : ''}${int}${scale > 0 ? `.${frac}` : ''}`
}

/** round-half-away-from-zero of num / den, den > 0. */
function roundHalfAway(num: bigint, den: bigint): bigint {
  const magnitude = num < 0n ? -num : num
  const rounded = (2n * magnitude + den) / (2n * den)
  return num < 0n ? -rounded : rounded
}

function randomScaled(rng: Rng, maxDigits: number, maxScale: number, allowNegative: boolean) {
  const digits = randomInt(rng, 1, maxDigits + 1)
  let n = 0n
  for (let i = 0; i < digits; i++) n = n * 10n + BigInt(randomInt(rng, 0, 10))
  if (allowNegative && rng() < 0.3) n = -n
  return { n, scale: randomInt(rng, 0, maxScale + 1) }
}

describe('property: lineTotalCents equals an independent exact oracle', () => {
  it('matches round-half-away(q x p x (100 - d) ) for 3000 random lines', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < 3000; i++) {
      const q = randomScaled(rng, 8, 6, true) // up to 99_999_999 with 6 decimals
      const p = randomScaled(rng, 8, 6, false)
      const hasDiscount = rng() < 0.5
      const d = hasDiscount ? BigInt(randomInt(rng, 0, 10_001)) : 0n // hundredths of a percent

      // cents = q * p * (100 - d/100) = qInt * pInt * (10000 - dInt) / (10^(qs+ps) * 100)
      const numerator = q.n * p.n * (10_000n - d)
      const denominator = 10n ** BigInt(q.scale + p.scale) * 100n
      const expected = roundHalfAway(numerator, denominator)

      const input: LineTotalInput = {
        quantity: scaled(q.n, q.scale),
        unitPrice: scaled(p.n, p.scale),
        ...(hasDiscount ? { discountPercent: scaled(d, 2) } : {}),
      }
      const label = `seed ${seed}, iteration ${i}, input ${JSON.stringify(input)}`

      if (
        expected > BigInt(Number.MAX_SAFE_INTEGER) ||
        expected < -BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        expect(() => lineTotalCents(input), label).toThrow(MoneyError)
      } else {
        expect(lineTotalCents(input).toString(), label).toBe(expected.toString())
      }
    }
  })

  it('rounds every exact half cent away from zero', () => {
    // price = (10k + 5) / 1000 euro with quantity 1 is exactly k + 0.5 cents.
    for (let k = 0; k <= 500; k++) {
      const unitPrice = scaled(BigInt(10 * k + 5), 3)
      expect(lineTotalCents({ quantity: '1', unitPrice }), `price ${unitPrice}`).toBe(k + 1)
      expect(lineTotalCents({ quantity: '-1', unitPrice }), `price ${unitPrice}`).toBe(-(k + 1))
    }
  })

  it('scales linearly in the quantity when the result is exact', () => {
    const rng = createRng()
    for (let i = 0; i < 500; i++) {
      const cents = BigInt(randomInt(rng, 0, 10_000_000))
      const unitPrice = scaled(cents, 2)
      const quantity = randomInt(rng, 0, 100_000)
      expect(
        lineTotalCents({ quantity: String(quantity), unitPrice }).toString(),
        `price ${unitPrice}, quantity ${quantity}`,
      ).toBe((cents * BigInt(quantity)).toString())
    }
  })
})
