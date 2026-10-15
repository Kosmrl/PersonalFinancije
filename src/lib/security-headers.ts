// Response security headers (OWASP Secure Headers baseline). Kept apart from next.config.ts so a
// unit test can read it. The CSP is Report-Only in Phase 1 (enforcing it is Phase 6), so it can
// only produce console reports and never blocks a page, in development or in production.

export type HeaderEntry = { key: string; value: string }

export function buildContentSecurityPolicy(isProd: boolean): string {
  return [
    "default-src 'self'",
    // 'unsafe-inline' is needed by Next's inline bootstrap scripts until nonces arrive (Phase 6);
    // 'unsafe-eval' only in development (React debugging, HMR).
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The dev server's hot-reload WebSocket.
    `connect-src 'self'${isProd ? '' : ' ws://localhost:* ws://127.0.0.1:*'}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function buildSecurityHeaders(isProd: boolean): HeaderEntry[] {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy-Report-Only', value: buildContentSecurityPolicy(isProd) },
    // HSTS only in production: on http://localhost it would pin the browser to HTTPS.
    ...(isProd
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
      : []),
  ]
}
