import { describe, expect, it } from 'vitest'
import { buildSecurityHeaders } from './security-headers'

const get = (headers: { key: string; value: string }[], key: string) =>
  headers.find((header) => header.key === key)?.value

describe('buildSecurityHeaders', () => {
  it('sets the fixed headers in every environment', () => {
    for (const isProd of [false, true]) {
      const headers = buildSecurityHeaders(isProd)
      expect(get(headers, 'X-Frame-Options')).toBe('DENY')
      expect(get(headers, 'X-Content-Type-Options')).toBe('nosniff')
      expect(get(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(get(headers, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
    }
  })

  it('sends HSTS in production only', () => {
    expect(get(buildSecurityHeaders(true), 'Strict-Transport-Security')).toContain('max-age=')
    expect(get(buildSecurityHeaders(false), 'Strict-Transport-Security')).toBeUndefined()
  })

  it('never enforces a CSP, only reports', () => {
    for (const isProd of [false, true]) {
      const headers = buildSecurityHeaders(isProd)
      expect(get(headers, 'Content-Security-Policy')).toBeUndefined()
      expect(get(headers, 'Content-Security-Policy-Report-Only')).toContain(
        "frame-ancestors 'none'",
      )
    }
  })

  it('allows eval and the hot-reload socket only in development', () => {
    const dev = get(buildSecurityHeaders(false), 'Content-Security-Policy-Report-Only')
    const prod = get(buildSecurityHeaders(true), 'Content-Security-Policy-Report-Only')
    expect(dev).toContain("'unsafe-eval'")
    expect(dev).toContain('ws://localhost:*')
    expect(prod).not.toContain("'unsafe-eval'")
    expect(prod).not.toContain('ws:')
  })
})
