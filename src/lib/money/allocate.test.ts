import { describe, expect, it } from 'vitest'
import { createRng, randomInt, testSeed, type Rng } from '../../../tests/helpers/fake'
import { allocateCents } from './allocate'
import { Decimal, MoneyError } from './decimal'

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)

describe('allocateCents: plan table', () => {
  it.each([
    [1000, [1, 1, 1], [334, 333, 333]],
    [1, [1, 1, 1], [1, 0, 0]],
    [0, [1, 2], [0, 0]],
    [-1000, [1, 1, 1], [-334, -333, -333]],
    [100, [1, 1, 1, 1, 1, 1, 1], [15, 15, 14, 14, 14, 14, 14]],
    [1000, [0, 1], [0, 1000]],
  ])('allocateCents(%i, %j) = %j', (total, weights, expected) => {
    const result = allocateCents(total, weights)
    expect(result).toEqual(expected)
    expect(sum(result)).toBe(total)
  })

  it.each([[[]], [[0]], [[0, 0]], [[0, 0, 0]]])(
    'rejects the weights %j (none, or all zero)',
    (weights) => {
      expect(() => allocateCents(1000, weights)).toThrow(MoneyError)
      try {
        allocateCents(1000, weights)
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_weights' })
      }
    },
  )
})

describe('allocateCents: more cases', () => {
  it.each([
    // The README example: 10.00 split three ways
    [1000, [1, 1, 1], [334, 333, 333]],
    [2, [1, 1, 1], [1, 1, 0]], // ties go to the earlier positions
    [3, [1, 1, 1], [1, 1, 1]],
    [4, [1, 1, 1], [2, 1, 1]],
    [100, [1, 1, 1], [34, 33, 33]],
    [101, [1, 1, 1], [34, 34, 33]],
    [1, [1], [1]],
    [1, [5], [1]],
    [99, [1], [99]],
    // Unequal weights: the extra cent goes to the largest remainder
    [10, [1, 2], [3, 7]],
    [10, [2, 1], [7, 3]],
    [100, [3, 1, 1, 1], [50, 17, 17, 16]],
    [100, [1, 3], [25, 75]],
    [101, [1, 3], [25, 76]], // 25.25 / 75.75: the second remainder is larger
    [5, [1, 1], [3, 2]],
    [1000, [50, 30, 20], [500, 300, 200]],
    // Zero weights never receive anything
    [1, [0, 1, 1], [0, 1, 0]],
    [10, [0, 1, 0, 1, 0], [0, 5, 0, 5, 0]],
    [7, [0, 1, 1, 0], [0, 4, 3, 0]],
    [1000, [0, 0, 1], [0, 0, 1000]],
    // Non-integer weights (strings: fractional JS numbers are rejected)
    [5, ['0.5', '0.5', '1.5'], [1, 1, 3]],
    [100, ['0.1', '0.2'], [33, 67]],
    [100, ['0.25', '0.25', '0.5'], [25, 25, 50]],
    // Zero and negative totals
    [0, [1], [0]],
    [0, [1, 1, 1], [0, 0, 0]],
    [-1, [1, 1, 1], [-1, 0, 0]],
    [-2, [1, 1, 1], [-1, -1, 0]],
    [-10, [1, 2], [-3, -7]],
    [-100, [1, 1, 1, 1, 1, 1, 1], [-15, -15, -14, -14, -14, -14, -14]],
    [-1000, [0, 1], [0, -1000]],
  ])('allocateCents(%i, %j) = %j', (total, weights, expected) => {
    const result = allocateCents(total, weights)
    expect(result).toEqual(expected)
    expect(sum(result)).toBe(total)
  })

  it('gives the biggest remainder the extra cent', () => {
    // 10 split 1:2 -> exact 3.33 / 6.67 -> the second share has the larger remainder.
    expect(allocateCents(10, [1, 2])).toEqual([3, 7])
  })

  it('splits the largest safe integer exactly', () => {
    const total = Number.MAX_SAFE_INTEGER
    const result = allocateCents(total, [1, 1, 1])
    expect(result).toEqual([3_002_399_751_580_331, 3_002_399_751_580_330, 3_002_399_751_580_330])
    expect(sum(result)).toBe(total)
    expect(sum(allocateCents(-total, [1, 1, 1]))).toBe(-total)
    expect(allocateCents(total, [1])).toEqual([total])
  })

  it('splits a large total by large weights without losing a cent', () => {
    const total = 99_999_999_999
    const weights = [333_333, 333_333, 333_334]
    const result = allocateCents(total, weights)
    expect(sum(result)).toBe(total)
  })

  it('never returns negative zero', () => {
    expect(allocateCents(-1, [1, 1]).every((v) => !Object.is(v, -0))).toBe(true)
    expect(allocateCents(-1, [0, 1]).every((v) => !Object.is(v, -0))).toBe(true)
    expect(allocateCents(0, [1, 1]).every((v) => !Object.is(v, -0))).toBe(true)
    expect(allocateCents(-0, [1, 1]).every((v) => !Object.is(v, -0))).toBe(true)
  })

  it('treats a negative-zero weight as zero', () => {
    expect(allocateCents(10, [-0, 1])).toEqual([0, 10])
  })

  it('does not mutate the weights and returns a new array', () => {
    const weights = Object.freeze([1, 2, 3])
    const result = allocateCents(60, weights)
    expect(result).toEqual([10, 20, 30])
    expect(weights).toEqual([1, 2, 3])
    expect(result).not.toBe(weights)
  })

  it('does not depend on the scale of the weights', () => {
    expect(allocateCents(1000, [10, 10, 10])).toEqual(allocateCents(1000, [1, 1, 1]))
    expect(allocateCents(1000, [1000, 2000, 3000])).toEqual(allocateCents(1000, [1, 2, 3]))
    expect(allocateCents(1000, ['0.1', '0.2', '0.3'])).toEqual(allocateCents(1000, [1, 2, 3]))
  })
})

describe('allocateCents: errors', () => {
  it.each([
    ['no weights', 1000, []],
    ['all zero weights', 1000, [0, 0]],
    ['a negative weight', 1000, [1, -1]],
    ['only a negative weight', 1000, [-1]],
    ['a tiny negative weight', 1000, [1, '-0.000001']],
    ['an empty list for a zero total', 0, []],
    ['all zero weights for a zero total', 0, [0, 0]],
  ])('rejects %s', (_name, total, weights) => {
    expect(() => allocateCents(total, weights)).toThrow(MoneyError)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['1.5', 1.5],
    ['-0.5', -0.5],
    ['2^53', 2 ** 53],
    ['-(2^53)', -(2 ** 53)],
  ])('rejects the total %s because it is not a safe integer number of cents', (_name, total) => {
    expect(() => allocateCents(total, [1, 1])).toThrow(MoneyError)
    expect(() => allocateCents(total, [1, 1])).toThrow(
      expect.objectContaining({ code: 'invalid_total' }),
    )
  })

  it.each([1.5, 0.1 + 0.2, 2 ** 53])(
    'rejects the fractional or unsafe JS number weight %s with invalid_decimal',
    (weight) => {
      expect(() => allocateCents(100, [1, weight])).toThrow(
        expect.objectContaining({ code: 'invalid_decimal' }),
      )
    },
  )

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects the weight %s', (_name, weight) => {
    expect(() => allocateCents(100, [1, weight])).toThrow(MoneyError)
  })

  it.each([
    ['a string with 31 significant digits', '1'.repeat(31)],
    ['a decimal string with 31 significant digits', '0.' + '1'.repeat(31)],
    ['31 digits with trailing zeros', '1' + '0'.repeat(30)],
    ['a Decimal with 31 significant digits', new Decimal('1'.repeat(31))],
  ])('rejects the weight %s with invalid_precision', (_name, weight) => {
    expect(() => allocateCents(100, [1, weight])).toThrow(MoneyError)
    expect(() => allocateCents(100, [1, weight])).toThrow(
      expect.objectContaining({ code: 'invalid_precision' }),
    )
  })

  it('accepts weights of exactly 30 significant digits and splits them without rounding', () => {
    const big = '9'.repeat(30)
    // Equal huge weights: the odd cent goes to the earlier entry, nothing is lost to precision.
    expect(allocateCents(101, [big, big])).toEqual([51, 50])
    expect(allocateCents(Number.MAX_SAFE_INTEGER, [big, big, big])).toEqual([
      3002399751580331, 3002399751580330, 3002399751580330,
    ])
  })

  it('uses a Croatian message', () => {
    expect(() => allocateCents(100, [])).toThrow('Potrebna je barem jedna težina.')
    expect(() => allocateCents(100, [0, 0])).toThrow('Zbroj težina mora biti veći od nule.')
    expect(() => allocateCents(100, [1, -1])).toThrow('Težine ne smiju biti negativne.')
    expect(() => allocateCents(1.5, [1])).toThrow('Ukupni iznos mora biti cijeli broj centi.')
  })
})

// ---------------------------------------------------------------------------------------------
// Property-style checks with plain loops, against an independent BigInt implementation of the
// largest-remainder method. The seed is part of every failure message.

/** Reference: largest remainder with earliest-first ties, leftover away from zero. Integers only. */
function reference(total: number, weights: readonly number[]): bigint[] {
  const magnitude = BigInt(Math.abs(total))
  const w = weights.map((x) => BigInt(x))
  const weightSum = w.reduce((a, b) => a + b, 0n)
  const shares = w.map((x) => ({
    floor: (magnitude * x) / weightSum,
    rem: (magnitude * x) % weightSum,
  }))
  let leftover = magnitude - shares.reduce((a, s) => a + s.floor, 0n)
  const order = shares
    .map((s, index) => ({ index, rem: s.rem }))
    .sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1))
  const extra = new Set<number>()
  for (const entry of order) {
    if (leftover <= 0n) break
    extra.add(entry.index)
    leftover -= 1n
  }
  const sign = total < 0 ? -1n : 1n
  return shares.map((s, i) => sign * (s.floor + (extra.has(i) ? 1n : 0n)))
}

function randomWeights(rng: Rng, maxLength: number, maxWeight: number): number[] {
  const length = randomInt(rng, 1, maxLength + 1)
  const weights: number[] = []
  for (let i = 0; i < length; i++) {
    // About a quarter of the weights are zero, as when a participant has no share.
    weights.push(rng() < 0.25 ? 0 : randomInt(rng, 1, maxWeight + 1))
  }
  if (!weights.some((x) => x !== 0)) {
    weights[randomInt(rng, 0, length)] = randomInt(rng, 1, maxWeight + 1)
  }
  return weights
}

describe('property: allocateCents', () => {
  const ITERATIONS = 3000

  it('always sums exactly to the total', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < ITERATIONS; i++) {
      const magnitude = i % 3 === 0 ? randomInt(rng, 0, 200) : randomInt(rng, 0, 2_000_000_000)
      const total = rng() < 0.4 && magnitude > 0 ? -magnitude : magnitude
      const weights = randomWeights(rng, 12, i % 2 === 0 ? 5 : 100_000)
      const result = allocateCents(total, weights)
      expect(sum(result), `seed ${seed}, total ${total}, weights ${JSON.stringify(weights)}`).toBe(
        total,
      )
    }
  })

  it('splits a very large total exactly', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < 500; i++) {
      const total = randomInt(rng, 1, 2 ** 31) * randomInt(rng, 1, 2 ** 21) // below 2^52
      const weights = randomWeights(rng, 8, 1_000_000)
      const result = allocateCents(total, weights)
      const label = `seed ${seed}, total ${total}, weights ${JSON.stringify(weights)}`
      expect(result.reduce((a, b) => a + BigInt(b), 0n).toString(), label).toBe(total.toString())
    }
  })

  it('matches the independent reference implementation', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < ITERATIONS; i++) {
      const magnitude = randomInt(rng, 0, i % 2 === 0 ? 500 : 1_000_000_000)
      const total = rng() < 0.4 && magnitude > 0 ? -magnitude : magnitude
      const weights = randomWeights(rng, 10, 20)
      expect(
        allocateCents(total, weights).map(String),
        `seed ${seed}, total ${total}, weights ${JSON.stringify(weights)}`,
      ).toEqual(reference(total, weights).map((x) => (x === 0n ? '0' : x.toString())))
    }
  })

  it('stays within one cent of the exact proportional share, and never favours a zero weight', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < ITERATIONS; i++) {
      const total = randomInt(rng, 0, 1_000_000)
      const weights = randomWeights(rng, 10, 50)
      const weightSum = weights.reduce((a, b) => a + b, 0)
      const result = allocateCents(total, weights)
      weights.forEach((weight, index) => {
        const label = `seed ${seed}, total ${total}, weights ${JSON.stringify(weights)}, index ${index}`
        const share = result[index] ?? Number.NaN
        const exactFloor = Math.floor((total * weight) / weightSum)
        expect(share, label).toBeGreaterThanOrEqual(exactFloor)
        expect(share, label).toBeLessThanOrEqual(exactFloor + 1)
        if (weight === 0) expect(share, label).toBe(0)
      })
    }
  })

  it('splits equal weights as evenly as possible, earlier positions first', () => {
    const rng = createRng()
    for (let i = 0; i < 500; i++) {
      const parts = randomInt(rng, 1, 30)
      const total = randomInt(rng, 0, 100_000)
      const result = allocateCents(total, new Array<number>(parts).fill(1))
      expect(sum(result)).toBe(total)
      const base = Math.floor(total / parts)
      const remainder = total - base * parts
      result.forEach((share, index) => {
        expect(share, `total ${total}, parts ${parts}, index ${index}`).toBe(
          base + (index < remainder ? 1 : 0),
        )
      })
    }
  })

  it('mirrors for a negative total', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < 1000; i++) {
      const total = randomInt(rng, 1, 1_000_000)
      const weights = randomWeights(rng, 8, 30)
      const positive = allocateCents(total, weights)
      const negative = allocateCents(-total, weights)
      expect(negative, `seed ${seed}, total ${total}, weights ${JSON.stringify(weights)}`).toEqual(
        positive.map((v) => (v === 0 ? 0 : -v)),
      )
    }
  })
})
