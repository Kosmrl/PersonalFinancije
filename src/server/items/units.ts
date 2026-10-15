// Units of measure for items: UN/ECE Recommendation 20 codes (the codes EN 16931 e-invoices use)
// with the Croatian labels shown to users. Pure data, shared by the form and the server-side
// validation, so unlike the rest of src/server it has no `server-only` import.

export const UNITS = [
  { code: 'H87', label: 'kom' },
  { code: 'HUR', label: 'sat' },
  { code: 'DAY', label: 'dan' },
  { code: 'MON', label: 'mjesec' },
  { code: 'C62', label: 'jedinica' },
  { code: 'KGM', label: 'kg' },
  { code: 'MTR', label: 'm' },
  { code: 'LTR', label: 'l' },
  { code: 'MTK', label: 'm²' },
  { code: 'KMT', label: 'km' },
] as const

export type UnitCode = (typeof UNITS)[number]['code']

export const UNIT_CODES = UNITS.map((unit) => unit.code) as [UnitCode, ...UnitCode[]]

/** Croatian label of a unit code; an unknown code is returned unchanged. */
export function unitLabel(code: string): string {
  return UNITS.find((unit) => unit.code === code)?.label ?? code
}
