/** Removes whitespace. Does not validate. */
export function normalizeOib(input: string): string {
  return input.replace(/\s/g, '')
}

/**
 * Validates a Croatian OIB (osobni identifikacijski broj): 11 ASCII digits whose last digit is
 * the ISO 7064 MOD 11,10 check digit of the first ten (ISO/IEC 7064:2003, "MOD 11,10",
 * the hybrid system as specified for the OIB by Porezna uprava).
 * Whitespace is stripped before validation.
 */
export function isValidOib(input: string): boolean {
  const oib = normalizeOib(input)
  if (!/^\d{11}$/.test(oib)) return false

  let remainder = 10
  for (let i = 0; i < 10; i++) {
    remainder = (remainder + oib.charCodeAt(i) - 48) % 10
    if (remainder === 0) remainder = 10
    remainder = (remainder * 2) % 11
  }
  const checkDigit = (11 - remainder) % 10
  return checkDigit === oib.charCodeAt(10) - 48
}
