import { Decimal, MoneyError, toDecimal, type DecimalInput } from './decimal'

export type LineTotalInput = {
  quantity: DecimalInput
  unitPrice: DecimalInput
  /** Percentage between 0 and 100 inclusive, at most 2 decimals. */
  discountPercent?: DecimalInput
}

// Inputs are limited to MAX_DECIMAL_PLACES decimals and MAX_SIGNIFICANT_DIGITS significant
// digits, so q x p x (100 - d) has at most 30 + 30 + 5 significant digits. The shared Decimal
// (precision 40) could round a 60-digit product, so the product is computed with a wider
// clone and is always exact; the only rounding is the final one to cents.
const Exact = Decimal.clone({ precision: 100 })
const HUNDRED = new Exact(100)
const MAX_DECIMAL_PLACES = 6
const MAX_SIGNIFICANT_DIGITS = 30

function checkPrecision(value: Decimal): Decimal {
  if (value.decimalPlaces() > MAX_DECIMAL_PLACES || value.sd(true) > MAX_SIGNIFICANT_DIGITS) {
    throw new MoneyError(
      'invalid_precision',
      'Količina i cijena smiju imati najviše 6 decimala i 30 značajnih znamenki.',
    )
  }
  return value
}

/**
 * Line total in cents: quantity x unit price x (1 - discount / 100), computed exactly with
 * decimal.js and rounded ONCE to cents, ROUND_HALF_UP (ties away from zero). Rounding rule:
 * roadmap §4.5. Intermediate products are never rounded.
 *
 * Throws MoneyError when the discount is out of range, the quantity or unit price has more
 * than 6 decimal places or 30 significant digits (`invalid_precision`), or the result does not
 * fit in a safe integer number of cents. A fractional quantity or price must be a string or a
 * Decimal, never a JS float (see toDecimal).
 */
export function lineTotalCents({
  quantity,
  unitPrice,
  discountPercent = 0,
}: LineTotalInput): number {
  const discount = toDecimal(discountPercent)
  if (discount.lt(0) || discount.gt(100) || discount.decimalPlaces() > 2) {
    throw new MoneyError(
      'invalid_discount',
      'Popust mora biti između 0 i 100 %, najviše 2 decimale.',
    )
  }

  // euros = q * p * (100 - d) / 100, so cents = euros * 100 = q * p * (100 - d): the two
  // factors of 100 cancel, so no division and no intermediate rounding is needed.
  const q = new Exact(checkPrecision(toDecimal(quantity)))
  const p = new Exact(checkPrecision(toDecimal(unitPrice)))
  const exactCents = q.mul(p).mul(HUNDRED.minus(discount))
  const cents = exactCents.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)

  // Checked on the Decimal, before converting to a number.
  if (cents.abs().gt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError('amount_too_large', 'Iznos stavke je prevelik.')
  }

  const value = cents.toNumber()
  return value === 0 ? 0 : value // normalizes -0
}
