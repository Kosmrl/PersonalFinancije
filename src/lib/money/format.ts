import { Decimal, MoneyError, toDecimal } from './decimal'

// Display edge only (CLAUDE.md): formatted strings must never flow back into stored values or
// calculations. Amounts are handed to Intl as exact decimal strings, never as floats.

const LOCALE = 'hr-HR'

const formatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string, fractionDigits?: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits ?? 'default'}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(
      LOCALE,
      fractionDigits === undefined
        ? { style: 'currency', currency }
        : {
            style: 'currency',
            currency,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
          },
    )
    formatters.set(key, formatter)
  }
  return formatter
}

/** Formats integer minor units, e.g. `123456` -> `1.234,56 €` (NBSP before the symbol). */
export function formatCents(cents: number, currency = 'EUR'): string {
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyError('invalid_decimal', 'Iznos mora biti cijeli broj centi.')
  }
  const formatter = currencyFormatter(currency)
  const minorDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  const exact = new Decimal(cents).div(new Decimal(10).pow(minorDigits)).toString()
  return formatter.format(exact as `${number}`)
}

/**
 * Formats a decimal string (e.g. a unit price read from the database) in full precision,
 * trimming trailing zeros down to a minimum of 2 decimals:
 * `0.125` -> `0,125 €`, `12.000000` -> `12,00 €`.
 */
export function formatDecimal(value: string, currency = 'EUR'): string {
  const exact = toDecimal(value)
  const scale = Math.max(2, exact.decimalPlaces())
  return currencyFormatter(currency, scale).format(exact.toString() as `${number}`)
}

/**
 * A decimal string as editable form text: comma as the decimal separator, no grouping, trailing
 * zeros trimmed (`"0.125000"` -> `"0,125"`, `"12.500000"` -> `"12,5"`). parseDecimal accepts the
 * result back unchanged. Used to prefill an edit form, never for storage or calculation.
 */
export function decimalToInputText(value: string): string {
  return toDecimal(value).toString().replace('.', ',')
}

/**
 * A decimal string in hr-HR grouping without a currency symbol, full precision with at least 2
 * decimals (`"1234.5"` -> `"1.234,50"`). Display only (the blur formatting of decimal inputs).
 */
export function formatDecimalPlain(value: string): string {
  const exact = toDecimal(value)
  const scale = Math.max(2, exact.decimalPlaces())
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(exact.toString() as `${number}`)
}
