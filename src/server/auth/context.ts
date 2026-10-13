import 'server-only'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { forbidden, type ActionFailure } from '@/server/actions/result'
import { getDb } from '@/server/db/client'
import { member, organization } from '@/server/db/schema'
import { getAuth } from './auth'

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

export const ORG_ROLES = ['owner', 'accountant', 'member'] as const
export type OrgRole = (typeof ORG_ROLES)[number]

// Type-level brand: the symbol is declared but never exists at runtime and is not exported, so
// only code in this module can write the property without a cast. A bare `{ orgId }` object
// does not satisfy OrgContext, so withTenant cannot be called with a made-up organization.
declare const orgContextBrand: unique symbol

/**
 * The verified tenant context: pass it to withTenant, recordAudit and the queries. Only
 * requireOrgContext produces one (tests use tests/helpers/org-context.ts).
 */
export type OrgContext = {
  readonly orgId: string
  readonly orgSlug: string
  readonly userId: string
  readonly role: OrgRole
  readonly [orgContextBrand]: true
}

// Runtime brand. The type brand above stops a bare literal, but a spread, Object.assign or an
// `as OrgContext` cast still compiles, and row-level security trusts whatever orgId reaches
// app.org_id. Every genuine context is registered here by requireOrgContext (or the test minter);
// withTenant and recordAudit call assertOrgContext, and a copy is a new object, so it fails.
const mintedContexts = new WeakSet<object>()

/** Throws unless `ctx` is the very object minted by requireOrgContext. The message holds no values. */
export function assertOrgContext(ctx: unknown): asserts ctx is OrgContext {
  if (typeof ctx !== 'object' || ctx === null || !mintedContexts.has(ctx)) {
    throw new Error('Invalid organization context')
  }
}

function mint(fields: Omit<OrgContext, typeof orgContextBrand>): OrgContext {
  const ctx = Object.freeze({ ...fields }) as OrgContext
  mintedContexts.add(ctx)
  return ctx
}

/**
 * Test-only minter, used through tests/helpers/org-context.ts. Refuses to run outside Vitest, so
 * a production import of it is useless.
 */
export function mintOrgContextForTests(fields: Omit<OrgContext, typeof orgContextBrand>): OrgContext {
  if (process.env.VITEST !== 'true') throw new Error('Test-only function')
  return mint(fields)
}

// Better Auth stores a member's role as a string that may list several roles separated by commas.
// The effective role is the most privileged known one; anything unknown grants nothing.
function effectiveRole(stored: string): OrgRole | null {
  const held = stored.split(',').map((part) => part.trim())
  return ORG_ROLES.find((role) => held.includes(role)) ?? null
}

/**
 * Authorization gate for organization actions and pages (plan: shared server-action contract).
 *
 * The membership is read from the database on every call: the session's "active organization" and
 * anything else the client can influence are never trusted. A user who is not a member of the
 * organization, and an organization that does not exist, are indistinguishable: both end in
 * notFound(). A member whose role is not in `roles` gets the Croatian refusal result. Without
 * `roles` every role is allowed (membership is enough).
 *
 * Better Auth tables have no row-level security, so this lookup uses the plain pool; tenant
 * tables are reached afterwards only through withTenant(ctx, ...).
 */
export async function requireOrgContext(
  orgSlug: string,
  options: { roles?: readonly OrgRole[] } = {},
): Promise<{ ok: true; ctx: OrgContext } | ActionFailure> {
  const { user } = await requireUser()

  const [row] = await getDb()
    .select({ orgId: organization.id, orgSlug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(organization.slug, orgSlug), eq(member.userId, user.id)))
    .limit(1)
  if (!row) notFound()

  const role = effectiveRole(row.role)
  if (!role || (options.roles && !options.roles.includes(role))) return forbidden()

  // The only place a context is minted: the membership was just read from the database.
  const ctx = mint({ orgId: row.orgId, orgSlug: row.orgSlug, userId: user.id, role })
  return { ok: true, ctx }
}
