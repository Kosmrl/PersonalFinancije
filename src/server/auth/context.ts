import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getAuth } from './auth'

// requireOrgContext (organization membership, roles) arrives with build-sequence step 5.

/** The current session from the request cookies, or null. Memoized per request. */
export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() })
})

/**
 * Authorization gate for user-level pages and actions: returns the signed-in user, or sends the
 * visitor to the sign-in page. Real check; proxy.ts is only a UX redirect.
 */
export async function requireUser() {
  const session = await getSession()
  if (!session?.user) redirect('/prijava')
  // Sign-in already refuses unverified addresses (requireEmailVerification); this keeps the
  // invariant explicit for sessions that might be created by other means.
  if (!session.user.emailVerified) redirect('/potvrda-emaila')
  return { user: session.user, session: session.session }
}

export type AuthedUser = Awaited<ReturnType<typeof requireUser>>['user']
