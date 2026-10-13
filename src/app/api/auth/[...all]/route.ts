import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/server/auth/auth'

// Better Auth endpoints (sign-up, sign-in, verification, reset, TOTP, organization, ...).
// getAuth() is resolved per request, so `next build` does not need runtime secrets.
export const dynamic = 'force-dynamic'

export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request)
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request)
