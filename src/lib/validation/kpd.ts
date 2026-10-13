/**
 * Normalizes a KPD (Klasifikacija proizvoda po djelatnostima) code to 6 digits, stripping dots
 * and whitespace: `62.01.11`, `620111` and ` 62 01 11 ` all become `620111`.
 * Returns `null` when the result is not exactly 6 digits. Phase 1 validates the format only.
 */
export function normalizeKpd(input: string): string | null {
  const stripped = input.replace(/[.\s]/g, '')
  return /^\d{6}$/.test(stripped) ? stripped : null
}

/** `620111` -> `62.01.11`. Anything that is not a normalized KPD code is returned unchanged. */
export function formatKpd(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 2)}.${code.slice(2, 4)}.${code.slice(4)}` : code
}
