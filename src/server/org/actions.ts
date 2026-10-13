'use server'

import 'server-only'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { isAPIError } from 'better-auth/api'
import {
  fail,
  FORBIDDEN_MESSAGE,
  ok,
  runAction,
  type ActionFailure,
  type ActionResult,
} from '@/server/actions/result'
import { recordAudit } from '@/server/audit/record'
import { getAuth } from '@/server/auth/auth'
import { orgIdOf, requireOrgContext, requireUser, type OrgContext } from '@/server/auth/context'
import { consumeActionLimit } from '@/server/auth/rate-limit'
import { getDb } from '@/server/db/client'
import { isUniqueViolation } from '@/server/db/errors'
import {
  invitation,
  member,
  obrtProfiles,
  organization,
  user as userTable,
} from '@/server/db/schema'
import { withTenant, type Tx } from '@/server/db/tenant'
import { sendMail } from '@/server/email/transport'
import { invitationTemplate } from '@/server/email/templates/invitation'
import { getAuthEnv } from '@/server/env'
import { log } from '@/server/log'
import { newAuthId } from './ids'
import { INVITATION_MESSAGES, LAST_OWNER_MESSAGE, PROFILE_FIRST_MESSAGE } from './messages'
import {
  getInvitationView,
  getObrtProfile,
  isOibRegistered,
  isSoleMember,
  organizationSlugExists,
} from './queries'
import {
  changeMemberRoleSchema,
  createOrganizationSchema,
  fieldErrors,
  invitationIdSchema,
  inviteMemberSchema,
  isNonHrIban,
  OIB_TAKEN_MESSAGE,
  removeMemberSchema,
  revokeInvitationSchema,
  updateObrtProfileSchema,
} from './schemas'
import { slugify, withSuffix } from './slug'

// Organization actions (plan: "Server actions"). Every action: authorization first
// (requireUser / requireOrgContext), then zod, then the change and its audit row.
//
// Member, invitation and organization-name changes are written directly with Drizzle inside the
// action's own withTenant transaction (pf_app has plain DML on Better Auth's tables). Better
// Auth's HTTP routes for the same operations are disabled (auth.ts, disabledPaths), so these
// actions are the only way in; every change commits atomically with its audit row.
//
// Never call auth.api.* while a transaction is open (review item B1). Better Auth takes its own
// connection from the same pool; with the organization row lock held by one request and the
// others waiting for it, ten parallel requests would hold every pool client while the lock
// holder waits for an eleventh. Only the calls that run outside any transaction use auth.api:
// createOrganization (onboarding) and accept/reject invitation.
//
// Last-owner protection: the action takes a row lock on the organization (FOR NO KEY UPDATE, so
// inserts that reference the organization are not blocked) with a 5 s lock_timeout; concurrent
// member changes of the same organization queue behind it, and the owner count is read under the
// lock.
//
// Tenant reads and writes carry an explicit organization_id filter (orgIdOf(ctx)) even though
// row-level security would also hide other tenants' rows: RLS is the safety net, the filter is
// the intent. Steps 7 and 8 (customers, items) follow the same pattern.
// Better Auth hooks never call withTenant (they run inside Better Auth's transaction).
//
// This is a 'use server' module: only async functions may be exported, and every export is a
// public endpoint. All of them take `unknown` and validate it.

/** Thrown inside a transaction to roll it back and return `failure` to the caller. */
class Abort extends Error {
  constructor(readonly failure: ActionFailure) {
    super('action aborted')
  }
}

const BAD_INPUT = 'Provjerite označena polja.'
const GENERIC = 'Došlo je do pogreške. Pokušajte ponovno.'

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVITATION_NOT_FOUND: INVITATION_MESSAGES.unavailable,
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: 'Obrt je dosegnuo najveći broj članova.',
}

function authErrorCode(error: unknown): string | undefined {
  if (!isAPIError(error)) return undefined
  const code = (error.body as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/** Runs a Better Auth server call; its refusals become an Abort (a failure result). */
async function callAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (!isAPIError(error)) throw error
    const code = authErrorCode(error)
    log.warn('better-auth call refused', { code, status: error.status })
    if (error.status === 'FORBIDDEN' || error.status === 'UNAUTHORIZED') {
      throw new Abort(fail(FORBIDDEN_MESSAGE))
    }
    throw new Abort(fail((code && AUTH_ERROR_MESSAGES[code]) || GENERIC))
  }
}

async function inTenant<T>(
  ctx: OrgContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<{ ok: true; value: T } | ActionFailure> {
  try {
    return { ok: true, value: await withTenant(ctx, fn) }
  } catch (error) {
    if (error instanceof Abort) return error.failure
    throw error
  }
}

function holdsOwnerRole(role: string): boolean {
  return role
    .split(',')
    .map((part) => part.trim())
    .includes('owner')
}

/**
 * Serializes member changes of one organization and returns its members, read under the lock.
 * (withTenant sets a 5 s lock_timeout: a request that cannot get the lock fails with SQLSTATE
 * 55P03, mapped by runAction to the generic retry message, instead of queueing forever.)
 *
 * Member and role changes are refused while the organization has no profile yet: until its owner
 * finished "Podaci o obrtu", nobody else may be added, or the onboarding (which reuses such an
 * organization) could put someone else's OIB, IBAN and address into a shared one. Revoking an
 * invitation stays possible (`requireProfile: false`), it only removes access.
 */
async function lockAndLoadMembers(
  tx: Tx,
  ctx: OrgContext,
  options: { requireProfile: boolean } = { requireProfile: true },
) {
  const orgId = orgIdOf(ctx)
  await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, orgId))
    .for('no key update')
  if (options.requireProfile) {
    const [profile] = await tx
      .select({ organizationId: obrtProfiles.organizationId })
      .from(obrtProfiles)
      .where(eq(obrtProfiles.organizationId, orgId))
      .limit(1)
    if (!profile) throw new Abort(fail(PROFILE_FIRST_MESSAGE))
  }
  return tx
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId))
}

function slugOf(input: unknown): string {
  const slug = (input as { orgSlug?: unknown } | null | undefined)?.orgSlug
  return typeof slug === 'string' ? slug : ''
}

function revalidateMembers(orgSlug: string) {
  revalidatePath(`/app/${orgSlug}/postavke/clanovi`)
}

// ---------------------------------------------------------------------------------------------
// Organization and profile

export async function createOrganizationWithProfile(
  input: unknown,
): Promise<ActionResult<{ orgSlug: string; nonHrIban: boolean }>> {
  return runAction('org.created', async () => {
    const { user } = await requireUser()
    const parsed = createOrganizationSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const data = parsed.data

    // Step 2 of the plan: the OIB must not be registered yet. The check is an enumeration
    // oracle, so it is rate limited per user (authoritative) and per client, and it is logged
    // without the OIB. The answer never says which organization holds it.
    const allowed = await consumeActionLimit(user.id, {
      user: { scope: 'oib-check', max: 10, windowSeconds: 15 * 60 },
      client: { scope: 'oib-check', max: 30, windowSeconds: 15 * 60 },
    })
    if (!allowed) {
      log.warn('oib check rate limited', { userId: user.id })
      return fail('Previše pokušaja. Pokušajte ponovno za nekoliko minuta.')
    }
    const taken = await isOibRegistered(data.oib)
    log.info('oib registration check', { userId: user.id, taken })
    if (taken) return fail(OIB_TAKEN_MESSAGE, { oib: OIB_TAKEN_MESSAGE })

    // Step 3: the organization, through Better Auth (or the existing one when finishing an
    // onboarding that stopped after this step).
    let orgSlug: string
    if (data.existingOrgSlug) {
      const existing = await requireOrgContext(data.existingOrgSlug, { roles: ['owner'] })
      if (!existing.ok) return existing
      if (await getObrtProfile(existing.ctx)) return fail('Podaci o obrtu već su uneseni.')
      if (!(await isSoleMember(existing.ctx))) return fail(PROFILE_FIRST_MESSAGE)
      orgSlug = existing.ctx.orgSlug
    } else {
      // An organization this user owns alone that never got its profile (an earlier submit lost
      // the OIB race or failed after step 3) is finished instead of leaving another orphan
      // behind. Organizations with other members are never reused (see isSoleMember).
      const orphan = await findOwnedOrganizationWithoutProfile(user.id)
      if (orphan) {
        orgSlug = orphan
      } else {
        const created = await createOrganizationWithUniqueSlug(data.tradeName, user.id)
        if (!created) return fail(GENERIC)
        orgSlug = created
      }
    }

    // Step 4, separate from step 3: the profile and its audit row, in one tenant transaction.
    // If this fails the organization exists without a profile; the org layout then sends the
    // owner back to finish onboarding (no compensation).
    const gate = await requireOrgContext(orgSlug, { roles: ['owner'] })
    if (!gate.ok) return gate
    const { ctx } = gate
    try {
      await withTenant(ctx, async (tx) => {
        // Re-verify under the organization row lock that the signed-in user is its only member
        // and its owner. FOR UPDATE (not NO KEY UPDATE) so that a member insert, which takes a
        // FOR KEY SHARE lock on this row through its foreign key, waits for this transaction
        // (acceptInvitation takes no organization lock of its own).
        await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, orgIdOf(ctx)))
          .for('update')
        const members = await tx
          .select({ userId: member.userId, role: member.role })
          .from(member)
          .where(eq(member.organizationId, orgIdOf(ctx)))
        const [only] = members
        if (members.length !== 1 || only?.userId !== ctx.userId || !holdsOwnerRole(only.role)) {
          throw new Abort(fail(PROFILE_FIRST_MESSAGE))
        }
        await tx.insert(obrtProfiles).values({
          organizationId: orgIdOf(ctx),
          tradeName: data.tradeName,
          ownerFullName: data.ownerFullName,
          oib: data.oib,
          street: data.street,
          postalCode: data.postalCode,
          city: data.city,
          countryCode: data.countryCode,
          iban: data.iban,
          email: data.email,
          phone: data.phone,
          website: data.website,
          inVatSystem: false,
          defaultInvoiceNote: data.defaultInvoiceNote,
        })
        // The organization was created with (or kept) another name when finishing an earlier
        // onboarding: keep it in step with the trade name (org switcher, invitation emails).
        await tx
          .update(organization)
          .set({ name: data.tradeName })
          .where(eq(organization.id, orgIdOf(ctx)))
        await recordAudit(tx, ctx, {
          action: 'org.created',
          entityType: 'organization',
          entityId: ctx.orgId,
          changedFields: ['name', 'slug'],
        })
      })
    } catch (error) {
      if (error instanceof Abort) return error.failure
      // Two sign-ups racing for the same OIB: the unique constraint decides.
      if (isUniqueViolation(error, 'obrt_profiles_oib_unique')) {
        return fail(OIB_TAKEN_MESSAGE, { oib: OIB_TAKEN_MESSAGE })
      }
      throw error
    }
    revalidatePath('/app', 'layout')
    return ok({ orgSlug, nonHrIban: isNonHrIban(data.iban) })
  })
}

/**
 * The slug of an organization the user owns ALONE that has no profile yet, if any (newest
 * first). Sole membership is decided in SQL, so the candidates are organizations that are the
 * user's own and nobody else's; the profile table is under row-level security and cannot be
 * checked there, so each candidate is checked inside its tenant context (the scan is capped).
 * The caller re-verifies sole membership under the lock when it writes the profile.
 */
async function findOwnedOrganizationWithoutProfile(userId: string): Promise<string | null> {
  const owned = await getDb()
    .select({ slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        eq(member.role, 'owner'),
        sql`not exists (
          select 1 from ${member} as other
           where other.organization_id = ${member.organizationId} and other.id <> ${member.id}
        )`,
      ),
    )
    .orderBy(desc(organization.createdAt), asc(organization.id))
    .limit(20)
  for (const { slug } of owned) {
    const gate = await requireOrgContext(slug, { roles: ['owner'] })
    if (!gate.ok) continue
    if (!(await getObrtProfile(gate.ctx))) return slug
  }
  return null
}

async function createOrganizationWithUniqueSlug(
  tradeName: string,
  userId: string,
): Promise<string | null> {
  const base = slugify(tradeName)
  let slug = base
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0 || (await organizationSlugExists(slug))) slug = withSuffix(base)
    try {
      // Server-side call with `userId`: no HTTP request, no session needed. The HTTP route is
      // disabled. The creator becomes the owner (creatorRole).
      await getAuth().api.createOrganization({ body: { name: tradeName, slug, userId } })
      return slug
    } catch (error) {
      // A concurrent request took the slug between the check and the insert: try another.
      if (authErrorCode(error) !== 'ORGANIZATION_ALREADY_EXISTS') throw error
    }
  }
  return null
}

export async function updateObrtProfile(
  input: unknown,
): Promise<ActionResult<{ nonHrIban: boolean }>> {
  return runAction('obrt_profile.updated', async () => {
    const gate = await requireOrgContext(slugOf(input), { roles: ['owner'] })
    if (!gate.ok) return gate
    const { ctx } = gate

    // The OIB is not in the schema: a posted `oib` is ignored (it identifies the taxpayer and
    // cannot change after onboarding).
    const parsed = updateObrtProfileSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const { orgSlug: _unused, ...next } = parsed.data
    void _unused

    const result = await inTenant(ctx, async (tx) => {
      const [current] = await tx
        .select()
        .from(obrtProfiles)
        .where(eq(obrtProfiles.organizationId, orgIdOf(ctx)))
        .limit(1)
        .for('update')
      if (!current) throw new Abort(fail('Podaci o obrtu nisu uneseni.'))
      const fields = Object.keys(next) as (keyof typeof next)[]
      const changed = fields.filter((key) => current[key] !== next[key])
      if (changed.length === 0) return
      await tx
        .update(obrtProfiles)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(obrtProfiles.organizationId, orgIdOf(ctx)))
      await recordAudit(tx, ctx, {
        action: 'obrt_profile.updated',
        entityType: 'obrt_profile',
        entityId: ctx.orgId,
        changedFields: changed,
      })
      // Keep the organization name (org switcher, invitation emails) in step with the trade name.
      if (changed.includes('tradeName')) {
        await tx
          .update(organization)
          .set({ name: next.tradeName })
          .where(eq(organization.id, orgIdOf(ctx)))
      }
    })
    if (!result.ok) return result
    revalidatePath(`/app/${ctx.orgSlug}`, 'layout')
    return ok({ nonHrIban: isNonHrIban(next.iban) })
  })
}

// ---------------------------------------------------------------------------------------------
// Members and invitations

// Better Auth's defaults, kept so that rows written here behave as its own (acceptInvitation
// checks the expiry and the pending status): invitations expire after 48 h, at most 100 are
// pending per organization.
const INVITATION_TTL_SQL = sql`now() + interval '48 hours'`
const PENDING_INVITATION_LIMIT = 100
const INVITATION_EMAIL_FAILED =
  'Pozivnica je spremljena, ali e-pošta nije poslana. Pokušajte ponovno poslati pozivnicu.'

export async function inviteMember(
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  return runAction('member.invited', async () => {
    const gate = await requireOrgContext(slugOf(input), { roles: ['owner'] })
    if (!gate.ok) return gate
    const { ctx } = gate
    const parsed = inviteMemberSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const data = parsed.data
    const email = data.email.toLowerCase()

    // Every invitation sends an email, so the sender is limited.
    const allowed = await consumeActionLimit(ctx.userId, {
      user: { scope: 'invite', max: 20, windowSeconds: 60 * 60 },
      client: { scope: 'invite', max: 60, windowSeconds: 60 * 60 },
    })
    if (!allowed) return fail('Previše pozivnica u kratkom roku. Pokušajte kasnije.')

    const result = await inTenant(ctx, async (tx) => {
      const orgId = orgIdOf(ctx)
      await lockAndLoadMembers(tx, ctx)

      const [existingMember] = await tx
        .select({ id: member.id })
        .from(member)
        .innerJoin(userTable, eq(userTable.id, member.userId))
        .where(and(eq(member.organizationId, orgId), sql`lower(${userTable.email}) = ${email}`))
        .limit(1)
      if (existingMember) throw new Abort(fail('Ta osoba već je član obrta.'))

      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
      if (!org) throw new Abort(fail(GENERIC))

      const pending = await tx
        .select({ id: invitation.id, email: invitation.email, role: invitation.role })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, orgId),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, sql`now()`),
          ),
        )
      const existing = pending.find((row) => row.email.toLowerCase() === email)

      let invitationId: string
      if (existing) {
        // Inviting the same address again re-arms the pending invitation: a fresh 48 h and a new
        // email, and the person joins with the role the owner chose last (Better Auth's own
        // resend would keep the old role).
        invitationId = existing.id
        const roleChanged = existing.role !== data.role
        // acceptInvitation takes no organization lock, so the invitation may have been accepted
        // since it was read above: update it only while still pending. If it was used in the
        // meantime the owner is told so and nothing is changed or audited (the person is a member
        // now; a fresh invitation would be refused as "already a member" anyway).
        const rearmed = await tx
          .update(invitation)
          .set({ expiresAt: INVITATION_TTL_SQL, ...(roleChanged ? { role: data.role } : {}) })
          .where(
            and(
              eq(invitation.id, existing.id),
              eq(invitation.organizationId, orgId),
              eq(invitation.status, 'pending'),
            ),
          )
          .returning({ id: invitation.id })
        if (rearmed.length === 0) throw new Abort(fail(INVITATION_MESSAGES.used))
        await recordAudit(tx, ctx, {
          action: 'member.invited',
          entityType: 'invitation',
          entityId: existing.id,
          changedFields: roleChanged ? ['role', 'expiresAt'] : ['expiresAt'],
        })
      } else {
        if (pending.length >= PENDING_INVITATION_LIMIT) {
          throw new Abort(fail('Dosegnut je najveći broj pozivnica na čekanju.'))
        }
        invitationId = newAuthId()
        await tx.insert(invitation).values({
          id: invitationId,
          organizationId: orgId,
          email,
          role: data.role,
          status: 'pending',
          expiresAt: INVITATION_TTL_SQL,
          inviterId: ctx.userId,
        })
        await recordAudit(tx, ctx, {
          action: 'member.invited',
          entityType: 'invitation',
          entityId: invitationId,
          changedFields: ['email', 'role', 'status'],
        })
      }
      return { invitationId, orgName: org.name }
    })
    if (!result.ok) return result
    revalidateMembers(ctx.orgSlug)

    // The email goes out after the commit, never inside the transaction. If sending fails the
    // invitation (and its audit row) stay; inviting the same address again resends it.
    const env = getAuthEnv()
    try {
      await sendMail({
        to: email,
        ...invitationTemplate({
          appName: env.APP_NAME,
          organizationName: result.value.orgName,
          role: data.role,
          url: `${env.BETTER_AUTH_URL}/pozivnica/${result.value.invitationId}`,
        }),
      })
    } catch (error) {
      log.error('invitation email failed', { invitationId: result.value.invitationId, error })
      return fail(INVITATION_EMAIL_FAILED)
    }
    return ok({ invitationId: result.value.invitationId })
  })
}

export async function revokeInvitation(
  input: unknown,
): Promise<ActionResult<Record<string, never>>> {
  return runAction('member.invitation_revoked', async () => {
    const gate = await requireOrgContext(slugOf(input), { roles: ['owner'] })
    if (!gate.ok) return gate
    const { ctx } = gate
    const parsed = revokeInvitationSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const { invitationId } = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      await lockAndLoadMembers(tx, ctx, { requireProfile: false })
      // 'canceled' is the status Better Auth 1.7.7 sets when an invitation is cancelled.
      const [row] = await tx
        .update(invitation)
        .set({ status: 'canceled' })
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.organizationId, orgIdOf(ctx)),
            eq(invitation.status, 'pending'),
          ),
        )
        .returning({ id: invitation.id })
      if (!row) throw new Abort(fail(INVITATION_MESSAGES.unavailable))
      await recordAudit(tx, ctx, {
        action: 'member.invitation_revoked',
        entityType: 'invitation',
        entityId: row.id,
        changedFields: ['status'],
      })
    })
    if (!result.ok) return result
    revalidateMembers(ctx.orgSlug)
    return ok({})
  })
}

export async function changeMemberRole(
  input: unknown,
): Promise<ActionResult<Record<string, never>>> {
  return runAction('member.role_changed', async () => {
    const gate = await requireOrgContext(slugOf(input), { roles: ['owner'] })
    if (!gate.ok) return gate
    const { ctx } = gate
    const parsed = changeMemberRoleSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const { memberId, role } = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      const members = await lockAndLoadMembers(tx, ctx)
      const target = members.find((row) => row.id === memberId)
      if (!target) throw new Abort(fail('Član ne postoji.'))
      if (target.role === role) return
      // The owner count is read under the organization lock, so two concurrent demotions of the
      // two last owners cannot both pass.
      const owners = members.filter((row) => holdsOwnerRole(row.role))
      if (holdsOwnerRole(target.role) && role !== 'owner' && owners.length <= 1) {
        throw new Abort(fail(LAST_OWNER_MESSAGE))
      }
      await tx
        .update(member)
        .set({ role })
        .where(and(eq(member.id, target.id), eq(member.organizationId, orgIdOf(ctx))))
      await recordAudit(tx, ctx, {
        action: 'member.role_changed',
        entityType: 'member',
        entityId: target.id,
        changedFields: ['role'],
      })
    })
    if (!result.ok) return result
    revalidateMembers(ctx.orgSlug)
    return ok({})
  })
}

export async function removeMember(input: unknown): Promise<ActionResult<Record<string, never>>> {
  return runAction('member.removed', async () => {
    const gate = await requireOrgContext(slugOf(input), { roles: ['owner'] })
    if (!gate.ok) return gate
    const { ctx } = gate
    const parsed = removeMemberSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const { memberId } = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      const members = await lockAndLoadMembers(tx, ctx)
      const target = members.find((row) => row.id === memberId)
      if (!target) throw new Abort(fail('Član ne postoji.'))
      const owners = members.filter((row) => holdsOwnerRole(row.role))
      if (holdsOwnerRole(target.role) && owners.length <= 1) {
        throw new Abort(fail(LAST_OWNER_MESSAGE))
      }
      await tx
        .delete(member)
        .where(and(eq(member.id, target.id), eq(member.organizationId, orgIdOf(ctx))))
      await recordAudit(tx, ctx, {
        action: 'member.removed',
        entityType: 'member',
        entityId: target.id,
      })
    })
    if (!result.ok) return result
    revalidateMembers(ctx.orgSlug)
    return ok({})
  })
}

async function authResult<T>(
  call: () => Promise<T>,
): Promise<{ value: T } | { failure: ActionFailure }> {
  try {
    return { value: await callAuth(call) }
  } catch (error) {
    if (error instanceof Abort) return { failure: error.failure }
    throw error
  }
}

export async function acceptInvitation(input: unknown): Promise<ActionResult<{ orgSlug: string }>> {
  return runAction('member.joined', async () => {
    const { user } = await requireUser()
    const parsed = invitationIdSchema.safeParse(input)
    if (!parsed.success) return fail(INVITATION_MESSAGES.unavailable)
    const { invitationId } = parsed.data

    // requireUser guarantees a verified email; the view compares it with the invitation's
    // (case-insensitively) and checks expiry, revocation and prior use. Better Auth checks
    // again and flips the status atomically (pending -> accepted).
    const view = await getInvitationView(user, invitationId)
    if (view.state !== 'open') return fail(INVITATION_MESSAGES[view.state])

    const requestHeaders = await headers()
    const accepted = await authResult(() =>
      getAuth().api.acceptInvitation({ body: { invitationId }, headers: requestHeaders }),
    )
    if ('failure' in accepted) return accepted.failure
    const orgId = accepted.value.invitation?.organizationId
    const memberId = accepted.value.member?.id
    if (!orgId || !memberId) return fail(INVITATION_MESSAGES.unavailable)

    const [org] = await getDb()
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    if (!org) return fail(INVITATION_MESSAGES.unavailable)

    // The user is a member now, so a real context can be minted for the audit row. It is a
    // separate transaction from Better Auth's, and the membership already exists: if the audit
    // write fails the failure is logged (member id only) and the join still succeeds.
    try {
      const gate = await requireOrgContext(org.slug)
      if (!gate.ok) throw new Error('no organization context after accepting an invitation')
      const { ctx } = gate
      await withTenant(ctx, async (tx) => {
        await recordAudit(tx, ctx, {
          action: 'member.joined',
          entityType: 'member',
          entityId: memberId,
          changedFields: ['role'],
        })
      })
    } catch (error) {
      log.error('member.joined audit row not written', { memberId, error })
    }
    revalidatePath('/app', 'layout')
    return ok({ orgSlug: org.slug })
  })
}

export async function declineInvitation(
  input: unknown,
): Promise<ActionResult<Record<string, never>>> {
  // No audit row: the person declining is not a member, so there is no tenant to attribute it to.
  return runAction('member.invitation_declined', async () => {
    const { user } = await requireUser()
    const parsed = invitationIdSchema.safeParse(input)
    if (!parsed.success) return fail(INVITATION_MESSAGES.unavailable)
    const { invitationId } = parsed.data
    const view = await getInvitationView(user, invitationId)
    if (view.state !== 'open') return fail(INVITATION_MESSAGES[view.state])
    const requestHeaders = await headers()
    const rejected = await authResult(() =>
      getAuth().api.rejectInvitation({ body: { invitationId }, headers: requestHeaders }),
    )
    if ('failure' in rejected) return rejected.failure
    return ok({})
  })
}
