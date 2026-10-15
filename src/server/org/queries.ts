import 'server-only'
import { and, asc, count, eq, gt, sql } from 'drizzle-orm'
import { orgIdOf, type OrgContext } from '@/server/auth/context'
import { getDb } from '@/server/db/client'
import { withTenant } from '@/server/db/tenant'
import {
  customers,
  invitation,
  items,
  member,
  obrtProfiles,
  organization,
  user,
} from '@/server/db/schema'

// Reads for the organization pages. Tenant tables (obrt_profiles) go through withTenant; Better
// Auth tables (member, invitation, organization, user) have no row-level security and are read on
// the plain pool, so every query there takes the organization id from orgIdOf(ctx), which throws
// for anything but a context minted by requireOrgContext.

export type { ObrtProfile } from '@/server/db/schema'

export async function getObrtProfile(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => {
    // Explicit organization filter on top of row-level security (see the note in actions.ts).
    const [row] = await tx
      .select()
      .from(obrtProfiles)
      .where(eq(obrtProfiles.organizationId, orgIdOf(ctx)))
      .limit(1)
    return row ?? null
  })
}

/**
 * Counts for the dashboard checklist. Counts only, no row content; archived rows count too,
 * because the step is "has added one", not "has one active".
 */
export async function getOnboardingCounts(
  ctx: OrgContext,
): Promise<{ customers: number; items: number }> {
  return withTenant(ctx, async (tx) => {
    const orgId = orgIdOf(ctx)
    const [customerRow] = await tx
      .select({ n: count() })
      .from(customers)
      .where(eq(customers.organizationId, orgId))
    const [itemRow] = await tx
      .select({ n: count() })
      .from(items)
      .where(eq(items.organizationId, orgId))
    return { customers: customerRow?.n ?? 0, items: itemRow?.n ?? 0 }
  })
}

/**
 * True when the signed-in user is the only member of the organization. An organization without a
 * profile may be finished (and its profile written) only by its sole member: otherwise another
 * member could end up co-owning an organization that holds someone else's OIB and IBAN.
 */
export async function isSoleMember(ctx: OrgContext): Promise<boolean> {
  const rows = await getDb()
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, orgIdOf(ctx)))
    .limit(2)
  return rows.length === 1 && rows[0]?.userId === ctx.userId
}

export type MemberRow = {
  id: string
  userId: string
  email: string
  displayName: string
  role: string
  joinedAt: Date
}

export async function listMembers(ctx: OrgContext): Promise<MemberRow[]> {
  return getDb()
    .select({
      id: member.id,
      userId: member.userId,
      email: user.email,
      displayName: user.name,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgIdOf(ctx)))
    .orderBy(asc(member.createdAt), asc(member.id))
}

export type PendingInvitationRow = {
  id: string
  email: string
  role: string | null
  expiresAt: Date
  createdAt: Date
}

export async function listPendingInvitations(ctx: OrgContext): Promise<PendingInvitationRow[]> {
  return getDb()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgIdOf(ctx)),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, sql`now()`),
      ),
    )
    .orderBy(asc(invitation.createdAt), asc(invitation.id))
}

export type MyOrganization = { id: string; slug: string; name: string; role: string }

/** The organizations a user belongs to. `userId` must come from requireUser. */
export async function listMyOrganizations(userId: string): Promise<MyOrganization[]> {
  return getDb()
    .select({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name), asc(organization.id))
}

/**
 * Cross-tenant "is this OIB taken" check (SECURITY DEFINER function; returns only a boolean).
 * It is an enumeration oracle: call it only from createOrganizationWithProfile, after the rate
 * limit, and never log its argument or let the answer say which organization holds the OIB.
 */
export async function isOibRegistered(oib: string): Promise<boolean> {
  const result = await getDb().execute<{ taken: boolean }>(
    sql`select public.oib_is_registered(${oib}) as taken`,
  )
  return result.rows[0]?.taken === true
}

export async function organizationSlugExists(slug: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)
  return Boolean(row)
}

export type InvitationView =
  | { state: 'unavailable' }
  | { state: 'wrong_recipient' }
  | { state: 'expired' | 'revoked' | 'used' | 'declined' }
  | { state: 'already_member'; orgSlug: string }
  | { state: 'open'; orgName: string; role: string | null }

/**
 * What the invitation page shows to the signed-in user. The organization name is returned only
 * when the invitation is addressed to this user's (verified) email, so holding the id without
 * being the recipient reveals nothing about the invitation (not who it was for, not the obrt).
 */
export async function getInvitationView(
  viewer: { id: string; email: string },
  invitationId: string,
): Promise<InvitationView> {
  const [row] = await getDb()
    .select({
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      orgName: organization.name,
      orgSlug: organization.slug,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, invitationId))
    .limit(1)
  if (!row) return { state: 'unavailable' }
  if (row.email.toLowerCase() !== viewer.email.toLowerCase()) return { state: 'wrong_recipient' }
  if (row.status === 'canceled') return { state: 'revoked' }
  if (row.status === 'accepted') return { state: 'used' }
  if (row.status === 'rejected') return { state: 'declined' }
  if (row.status !== 'pending') return { state: 'unavailable' }
  if (row.expiresAt.getTime() < Date.now()) return { state: 'expired' }
  const [existing] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, viewer.id)))
    .limit(1)
  if (existing) return { state: 'already_member', orgSlug: row.orgSlug }
  return { state: 'open', orgName: row.orgName, role: row.role }
}
