import 'server-only'
import { randomInt } from 'node:crypto'

// Organization slugs (plan: "Slug generation"): lower-case the trade name, transliterate the
// Croatian letters, replace everything else with `-`, cut to 40 characters.

const MAX_LENGTH = 40

// Every static segment under /app (a slug would shadow it) plus words that are confusing in a
// URL. `novi-obrt` and `profil` are real routes today; the rest are reserved for later.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'novi-obrt',
  'profil',
  'api',
  'app',
  'postavke',
  'pozivnica',
  'prijava',
  'registracija',
  'odjava',
  'admin',
  'new',
  'static',
  'public',
  'login',
  'logout',
  'settings',
  'null',
  'undefined',
])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug)
}

const TRANSLITERATION: Record<string, string> = {
  č: 'c',
  ć: 'c',
  đ: 'd',
  š: 's',
  ž: 'z',
}

/** The base slug for a trade name; never empty, never reserved. */
export function slugify(name: string): string {
  const lower = name.toLowerCase().replace(/[čćđšž]/g, (char) => TRANSLITERATION[char] ?? char)
  // Other accented letters (á, ö, ...): drop the combining marks.
  const ascii = lower.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '')
  if (!slug) return withSuffix('obrt')
  return isReservedSlug(slug) ? withSuffix(slug) : slug
}

/** `base-xxxx` with 4 random base36 characters; the base is shortened to keep within the limit. */
export function withSuffix(base: string): string {
  let suffix = ''
  for (let i = 0; i < 4; i++) suffix += randomInt(0, 36).toString(36)
  return `${base.slice(0, MAX_LENGTH).replace(/-+$/g, '')}-${suffix}`
}
