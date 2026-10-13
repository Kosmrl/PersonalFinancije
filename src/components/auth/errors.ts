type AuthError = { code?: string; status?: number } | null | undefined

// Croatian messages for Better Auth error codes. Credential errors are deliberately generic so
// the forms never reveal whether an address has an account.
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Pogrešna e-pošta ili lozinka.',
  INVALID_PASSWORD: 'Pogrešna lozinka.',
  PASSWORD_TOO_SHORT: 'Lozinka mora imati najmanje 10 znakova.',
  PASSWORD_TOO_LONG: 'Lozinka je predugačka.',
  INVALID_EMAIL: 'Unesite ispravnu adresu e-pošte.',
  INVALID_TOKEN: 'Poveznica je nevažeća ili je istekla. Zatražite novu.',
  TOKEN_EXPIRED: 'Poveznica je istekla. Zatražite novu.',
  INVALID_CODE: 'Pogrešan kod. Pokušajte ponovno.',
  INVALID_TWO_FACTOR_COOKIE: 'Prijava je istekla. Prijavite se ponovno.',
  INVALID_BACKUP_CODE: 'Pogrešan pričuvni kod.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Previše pokušaja. Pokušajte ponovno za nekoliko minuta.',
}

export const GENERIC_ERROR = 'Došlo je do pogreške. Pokušajte ponovno.'
export const RATE_LIMIT_ERROR = 'Previše pokušaja. Pokušajte ponovno za nekoliko trenutaka.'

export function authErrorMessage(error: AuthError, fallback = GENERIC_ERROR): string {
  if (!error) return fallback
  if (error.status === 429) return RATE_LIMIT_ERROR
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code]!
  return fallback
}

/**
 * Only same-site paths under /app (and the invitation page /pozivnica/<id>) are accepted as post-sign-in destinations (no open redirect).
 * The value is parsed the way a browser would (which strips tabs and newlines), and the result
 * is rebuilt from the parsed parts.
 */
export function safeNextPath(
  next: string | string[] | null | undefined,
  fallback = '/app',
): string {
  if (typeof next !== 'string' || !next) return fallback
  // Control characters and backslashes are never legitimate here.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  let url: URL
  try {
    url = new URL(next, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback
  const inApp = url.pathname === '/app' || url.pathname.startsWith('/app/')
  // The invitation page: sign in (or register) from it, then come back to it.
  const invitation = /^\/pozivnica\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname)
  if (!inApp && !invitation) return fallback
  return url.pathname + url.search + url.hash
}

const BASE = 'https://x.invalid'
