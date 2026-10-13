import { Decimal } from './decimal'

export type ParseErrorCode =
  'required' | 'malformed' | 'ambiguous' | 'decimal_separator' | 'negative' | 'scale' | 'too_large'

export type ParseFailure = { ok: false; code: ParseErrorCode; error: string }
export type ParseResult<T> = { ok: true; value: T } | ParseFailure

export type ParseAmountOptions = {
  allowNegative?: boolean
  /** Maximum absolute value in cents. Default 99_999_999_999 (999.999.999,99). */
  max?: number
  /** When true, an empty input is `{ ok: true, value: null }` instead of an error. */
  optional?: boolean
}

export type ParseDecimalOptions = {
  maxScale?: number
  allowNegative?: boolean
  /** When true, an empty input is `{ ok: true, value: null }` instead of an error. */
  optional?: boolean
}

const DEFAULT_MAX_CENTS = 99_999_999_999
const MAX_INPUT_LENGTH = 40

const MESSAGES: Record<Exclude<ParseErrorCode, 'scale'>, string> = {
  required: 'Obavezno polje.',
  malformed: 'Neispravan iznos.',
  ambiguous: 'Nejasan iznos. Upišite npr. 1.234,00 ili 1,234.',
  decimal_separator: 'Za decimale koristite zarez.',
  negative: 'Iznos ne smije biti negativan.',
  too_large: 'Iznos je prevelik.',
}

const AMOUNT_AMBIGUOUS_MESSAGE = 'Nejasan iznos. Upišite npr. 1.234,00 ili 1,23.'

function fail(code: Exclude<ParseErrorCode, 'scale'>): ParseFailure {
  return { ok: false, code, error: MESSAGES[code] }
}

function scaleFailure(maxScale: number): ParseFailure {
  let error: string
  if (maxScale === 0) error = 'Decimale nisu dopuštene.'
  else if (maxScale === 1) error = 'Najviše 1 decimala.'
  else if (maxScale <= 4) error = `Najviše ${maxScale} decimale.`
  else error = `Najviše ${maxScale} decimala.`
  return { ok: false, code: 'scale', error }
}

// Thousands-grouped integer parts: first group 1-3 digits (no leading zero), then groups of 3.
const DOT_GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/
const SPACE_GROUPED = /^[1-9]\d{0,2}( \d{3})+$/
const PLAIN_DIGITS = /^\d+$/
// The only characters that may follow the sign: ASCII digits, the two separators, and
// space / NBSP (U+00A0) / narrow NBSP (U+202F) as thousands separators.
const ALLOWED_BODY = /^[0-9.,   ]+$/

type Parts = { negative: boolean; int: string; frac: string }
type SplitResult = { ok: true; parts: Parts } | ParseFailure

/** Validates an integer part, which may be thousands-grouped with dots or with spaces. */
function integerDigits(raw: string): string | null {
  const hasDot = raw.includes('.')
  const normalized = raw.replace(/[  ]/g, ' ')
  const hasSpace = normalized.includes(' ')
  if (hasDot && hasSpace) return null
  if (hasDot) return DOT_GROUPED.test(raw) ? raw.replaceAll('.', '') : null
  if (hasSpace) return SPACE_GROUPED.test(normalized) ? normalized.replaceAll(' ', '') : null
  return PLAIN_DIGITS.test(raw) ? raw : null
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1
}

/**
 * Splits a user-typed number into sign, integer digits and fraction digits.
 * Croatian format is the default: comma is the decimal separator, dot or space groups thousands.
 * A single dot with no comma is an English-style decimal point, unless it matches the
 * ambiguous thousands pattern `^[1-9]\d{0,2}\.\d{3}$`.
 */
function splitNumber(input: string, allowNegative: boolean): SplitResult {
  const text = input.trim()
  if (text.length > MAX_INPUT_LENGTH) return fail('malformed')

  let negative = false
  let body = text
  const first = text.charAt(0)
  if (first === '-' || first === '−' || first === '+') {
    negative = first !== '+'
    body = text.slice(1)
  }
  if (body === '' || !ALLOWED_BODY.test(body)) return fail('malformed')
  if (count(body, ',') > 1) return fail('malformed')

  let int: string | null
  let frac: string

  if (body.includes(',')) {
    const [intRaw = '', fracRaw = ''] = body.split(',')
    if (fracRaw.includes('.')) return fail('decimal_separator')
    if (intRaw === '' || !PLAIN_DIGITS.test(fracRaw)) return fail('malformed')
    int = integerDigits(intRaw)
    frac = fracRaw
  } else {
    const dots = count(body, '.')
    if (dots === 0) {
      int = integerDigits(body)
      frac = ''
    } else if (dots === 1) {
      const [intRaw = '', fracRaw = ''] = body.split('.')
      if (intRaw === '' || !PLAIN_DIGITS.test(fracRaw)) return fail('malformed')
      if (/^[1-9]\d{0,2}$/.test(intRaw) && fracRaw.length === 3) return fail('ambiguous')
      int = integerDigits(intRaw)
      frac = fracRaw
    } else {
      // Two or more dots can only be thousands separators.
      int = DOT_GROUPED.test(body) ? body.replaceAll('.', '') : null
      frac = ''
    }
  }

  if (int === null) return fail('malformed')
  if (negative && !allowNegative) return fail('negative')

  return { ok: true, parts: { negative, int: int.replace(/^0+(?=\d)/, ''), frac } }
}

function isBlank(input: string | null | undefined): boolean {
  return input === null || input === undefined || input.trim() === ''
}

/**
 * Parses a user-typed decimal (unit price, quantity) into a normalized decimal string such as
 * "0.125": dot separator, no grouping, trailing zeros removed, never "-0". Never uses floats.
 * Rules: "Money & date edge cases" in docs/plans/2026-10-09-phase-1-foundation.md.
 */
export function parseDecimal(
  input: string | null | undefined,
  opts: ParseDecimalOptions & { optional: true },
): ParseResult<string | null>
export function parseDecimal(
  input: string | null | undefined,
  opts?: ParseDecimalOptions,
): ParseResult<string>
export function parseDecimal(
  input: string | null | undefined,
  opts: ParseDecimalOptions = {},
): ParseResult<string | null> {
  const { maxScale = 6, allowNegative = false, optional = false } = opts
  if (input === null || input === undefined || isBlank(input)) {
    return optional ? { ok: true, value: null } : fail('required')
  }

  const split = splitNumber(input, allowNegative)
  if (!split.ok) return split
  const { negative, int, frac } = split.parts

  if (frac.length > maxScale) return scaleFailure(maxScale)

  const fracTrimmed = frac.replace(/0+$/, '')
  const isZero = /^0*$/.test(int) && fracTrimmed === ''
  const sign = negative && !isZero ? '-' : ''
  const value = fracTrimmed === '' ? `${sign}${int}` : `${sign}${int}.${fracTrimmed}`
  return { ok: true, value }
}

/**
 * Parses a user-typed amount into integer minor units (cents). Never uses floats and never
 * rounds: more than 2 decimals is an error.
 * Rules: "Money & date edge cases" in docs/plans/2026-10-09-phase-1-foundation.md.
 */
export function parseAmountToCents(
  input: string | null | undefined,
  opts: ParseAmountOptions & { optional: true },
): ParseResult<number | null>
export function parseAmountToCents(
  input: string | null | undefined,
  opts?: ParseAmountOptions,
): ParseResult<number>
export function parseAmountToCents(
  input: string | null | undefined,
  opts: ParseAmountOptions = {},
): ParseResult<number | null> {
  const { allowNegative = false, max = DEFAULT_MAX_CENTS, optional = false } = opts
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new RangeError('parseAmountToCents: max must be a non-negative safe integer (cents).')
  }
  if (input === null || input === undefined || isBlank(input)) {
    return optional ? { ok: true, value: null } : fail('required')
  }

  const split = splitNumber(input, allowNegative)
  if (!split.ok) {
    // A dot-and-three-digits input like "1.234" is an amount here, so suggest amount formats.
    return split.code === 'ambiguous' ? { ...split, error: AMOUNT_AMBIGUOUS_MESSAGE } : split
  }
  const { negative, int, frac } = split.parts

  if (frac.length > 2) return scaleFailure(2)

  const cents = new Decimal(int + frac.padEnd(2, '0'))
  // max is a safe integer, so this also guarantees toNumber() below is exact.
  if (cents.gt(max) || cents.gt(Number.MAX_SAFE_INTEGER)) return fail('too_large')

  const value = cents.toNumber()
  return { ok: true, value: negative && value !== 0 ? -value : value }
}
