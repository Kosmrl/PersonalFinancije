import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

// UX only: sends visitors without a session cookie from /app/** to the sign-in page. The cookie
// is not validated here. Real authorization happens in layouts, server actions and route
// handlers (requireUser, requireOrgContext).
export function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request)
  if (hasSessionCookie) return NextResponse.next()

  const url = request.nextUrl.clone()
  const next = request.nextUrl.pathname + request.nextUrl.search
  url.pathname = '/prijava'
  url.search = ''
  url.searchParams.set('next', next)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/app/:path*'],
}
