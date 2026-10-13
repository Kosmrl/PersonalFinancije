// IBAN length per country (SWIFT IBAN Registry, ISO 13616-1). EU and EEA members, the other SEPA
// countries (AD, GB, CH, GI, MC, SM, VA) because customers and foreign neobank accounts
// commonly use them. Unknown countries are rejected because their length cannot be checked.
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GI: 23,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  VA: 22,
}

/** Strips all whitespace and upper-cases. Does not validate. */
export function normalizeIban(input: string): string {
  return input.replace(/\s/g, '').toUpperCase()
}

/** Country code of a normalized-looking IBAN (its first two letters), or null. */
export function ibanCountryCode(input: string): string | null {
  const match = /^[A-Z]{2}/.exec(normalizeIban(input))
  return match ? match[0] : null
}

/**
 * ISO 13616 validation: known country, exact length for that country, check digits 02-98, and a
 * mod-97 check of 1.
 * Lower case and spaces are accepted.
 */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  if (IBAN_LENGTHS[iban.slice(0, 2)] !== iban.length) return false
  // ISO 13616: check digits are 02-98 (00, 01 and 99 are reserved and never issued).
  const checkDigits = iban.slice(2, 4)
  if (checkDigits < '02' || checkDigits > '98') return false
  // Croatian IBANs are digits only (HR + 2 check digits + 17-digit BBAN).
  if (iban.startsWith('HR') && !/^HR\d{19}$/.test(iban)) return false

  // Move the first four characters to the end, then replace letters by 10..35.
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const code = char.charCodeAt(0)
    const value = code >= 65 ? code - 55 : code - 48 // A=65 -> 10, '0'=48 -> 0
    remainder = (value > 9 ? remainder * 100 + value : remainder * 10 + value) % 97
  }
  return remainder === 1
}

/** Groups of 4 separated by a space: `HR1210010051863000160` -> `HR12 1001 0051 8630 0016 0`. */
export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})(?=.)/g, '$1 ')
}
