import { Decimal, MoneyError, toDecimal, type DecimalInput } from './decimal'

// Weights are limited to MAX_SIGNIFICANT_DIGITS significant digits, so total (at most 16 digits)
// x weight stays under 50 digits. The shared Decimal (precision 40) could round such a product,
// so the arithmetic runs on a wider clone and is always exact (same approach as line-total.ts).
const Exact = Decimal.clone({ precision: 100 })
const MAX_SIGNIFICANT_DIGITS = 30

/**
 * Splits `total` cents proportionally to `weights` with the largest-remainder method
 * (roadmap §4.5): each share is floored, then the leftover cents go to the entries with the
 * largest fractional remainders. Ties go to the earlier position. For a negative total the
 * leftover goes away from zero, again earliest first. The shares always sum to `total`.
 *
 * All arithmetic is exact (decimal.js). Weights are integers (cents in practice), strings or
 * Decimals; a fractional JS number is rejected by toDecimal. Throws MoneyError for no weights,
 * an all-zero or negative weight (`invalid_weights`), a weight with more than 30 significant
 * digits (`invalid_precision`), or a total that is not a safe integer (`invalid_total`).
 */
export function allocateCents(total: number, weights: readonly DecimalInput[]): number[] {
  if (!Number.isSafeInteger(total)) {
    throw new MoneyError('invalid_total', 'Ukupni iznos mora biti cijeli broj centi.')
  }
  if (weights.length === 0) {
    throw new MoneyError('invalid_weights', 'Potrebna je barem jedna težina.')
  }

  const w = weights.map((weight) => {
    const d = toDecimal(weight)
    if (d.sd(true) > MAX_SIGNIFICANT_DIGITS) {
      throw new MoneyError('invalid_precision', 'Težine smiju imati najviše 30 značajnih znamenki.')
    }
    if (d.isNegative() && !d.isZero()) {
      throw new MoneyError('invalid_weights', 'Težine ne smiju biti negativne.')
    }
    return new Exact(d.abs()) // abs() normalizes -0
  })
  const weightSum = w.reduce((sum, d) => sum.plus(d), new Exact(0))
  if (weightSum.isZero()) {
    throw new MoneyError('invalid_weights', 'Zbroj težina mora biti veći od nule.')
  }

  const magnitude = new Exact(total).abs()
  const shares = w.map((d) => {
    const exact = magnitude.mul(d)
    return { floor: exact.divToInt(weightSum), remainder: exact.mod(weightSum) }
  })

  const floored = shares.reduce((sum, s) => sum.plus(s.floor), new Exact(0))
  let leftover = magnitude.minus(floored).toNumber()

  // Largest remainder first; equal remainders keep their original (earlier-first) order.
  const byRemainder = shares
    .map((s, index) => ({ index, remainder: s.remainder }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index)

  const extra = new Set<number>()
  for (const entry of byRemainder) {
    if (leftover <= 0) break
    extra.add(entry.index)
    leftover -= 1
  }

  const sign = total < 0 ? -1 : 1
  const result = shares.map((s, index) => {
    const value = s.floor.toNumber() + (extra.has(index) ? 1 : 0)
    return value === 0 ? 0 : sign * value
  })

  // Invariant: the shares always add up to the total.
  const sum = result.reduce((acc, n) => acc.plus(n), new Exact(0))
  if (!sum.eq(total)) {
    throw new MoneyError('invalid_total', 'Raspodjela ne zbraja u ukupni iznos.')
  }
  return result
}
