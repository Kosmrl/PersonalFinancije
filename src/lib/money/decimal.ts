import DecimalBase from 'decimal.js'

// Rounding rule: roadmap §4.5. A line total is rounded once to cents with ROUND_HALF_UP. In
// decimal.js ROUND_HALF_UP rounds ties away from zero, so -49.995 -> -50.00, symmetric with
// 49.995 -> 50.00. This clone (precision 40) is the general-purpose one for parsing and
// formatting. Exact products are computed on wider clones (precision 100) in line-total.ts and
// allocate.ts, whose inputs are limited to 30 significant digits, so no intermediate result is
// ever rounded and the only rounding is the final one to cents.
//
// A clone is used so that this configuration never leaks into (or from) any other code that
// imports decimal.js directly. Exponent notation is disabled so toString() always returns a
// plain decimal string (the ESLint money rules ban .toFixed()).
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -1000,
  toExpPos: 1000,
})

export type Decimal = InstanceType<typeof Decimal>

/** A value that can be turned into an exact Decimal. Prefer strings for user input. */
export type DecimalInput = string | number | Decimal

export type MoneyErrorCode =
  | 'amount_too_large'
  | 'invalid_decimal'
  | 'invalid_discount'
  | 'invalid_weights'
  | 'invalid_total'
  | 'invalid_precision'

/** Thrown by the pure money functions for inputs they cannot compute. `message` is Croatian. */
export class MoneyError extends Error {
  readonly code: MoneyErrorCode

  constructor(code: MoneyErrorCode, message: string) {
    super(message)
    this.name = 'MoneyError'
    this.code = code
  }
}

const DECIMAL_STRING = /^[+-]?\d+(\.\d+)?$/

/**
 * Converts to a Decimal without any float arithmetic; throws MoneyError on garbage.
 * A `number` is accepted only when it is a safe integer: a fractional JS number (such as
 * 0.3 * 0.75) is already inexact, so fractional values must arrive as strings or Decimals.
 */
export function toDecimal(value: DecimalInput): Decimal {
  if (typeof value === 'string') {
    if (!DECIMAL_STRING.test(value)) {
      throw new MoneyError('invalid_decimal', 'Neispravan decimalni broj.')
    }
    return new Decimal(value)
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError('invalid_decimal', 'Neispravan decimalni broj.')
    }
    return new Decimal(value)
  }
  if (!value.isFinite()) {
    throw new MoneyError('invalid_decimal', 'Neispravan decimalni broj.')
  }
  return new Decimal(value)
}
