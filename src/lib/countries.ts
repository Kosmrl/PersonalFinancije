// Fixed list of countries a customer can be in (ISO 3166-1 alpha-2) with Croatian names: Croatia,
// the EU and EEA, and the neighbours and trading partners a Croatian sole trader most often
// invoices. Pure data, shared by the form and the server-side validation.

export const COUNTRIES: readonly { code: string; name: string }[] = [
  { code: 'HR', name: 'Hrvatska' },
  { code: 'AL', name: 'Albanija' },
  { code: 'AT', name: 'Austrija' },
  { code: 'BE', name: 'Belgija' },
  { code: 'BA', name: 'Bosna i Hercegovina' },
  { code: 'BG', name: 'Bugarska' },
  { code: 'CY', name: 'Cipar' },
  { code: 'ME', name: 'Crna Gora' },
  { code: 'CZ', name: 'Češka' },
  { code: 'DK', name: 'Danska' },
  { code: 'EE', name: 'Estonija' },
  { code: 'FI', name: 'Finska' },
  { code: 'FR', name: 'Francuska' },
  { code: 'GR', name: 'Grčka' },
  { code: 'IE', name: 'Irska' },
  { code: 'IS', name: 'Island' },
  { code: 'IT', name: 'Italija' },
  { code: 'CA', name: 'Kanada' },
  { code: 'LV', name: 'Latvija' },
  { code: 'LI', name: 'Lihtenštajn' },
  { code: 'LT', name: 'Litva' },
  { code: 'LU', name: 'Luksemburg' },
  { code: 'HU', name: 'Mađarska' },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Nizozemska' },
  { code: 'DE', name: 'Njemačka' },
  { code: 'NO', name: 'Norveška' },
  { code: 'PL', name: 'Poljska' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Rumunjska' },
  { code: 'US', name: 'Sjedinjene Američke Države' },
  { code: 'MK', name: 'Sjeverna Makedonija' },
  { code: 'SK', name: 'Slovačka' },
  { code: 'SI', name: 'Slovenija' },
  { code: 'RS', name: 'Srbija' },
  { code: 'ES', name: 'Španjolska' },
  { code: 'SE', name: 'Švedska' },
  { code: 'CH', name: 'Švicarska' },
  { code: 'GB', name: 'Ujedinjeno Kraljevstvo' },
]

export const COUNTRY_CODES: readonly string[] = COUNTRIES.map((country) => country.code)

export function countryName(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.name ?? code
}
