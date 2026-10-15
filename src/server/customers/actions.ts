'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { fail, ok, runAction, type ActionFailure, type ActionResult } from '@/server/actions/result'
import { recordAudit } from '@/server/audit/record'
import { orgIdOf, requireOrgContext, type OrgContext } from '@/server/auth/context'
import { isUniqueViolation } from '@/server/db/errors'
import { customers } from '@/server/db/schema'
import { withTenant, type Tx } from '@/server/db/tenant'
import { fieldErrors } from '@/server/org/schemas'
import {
  ARCHIVED_MESSAGE,
  customerIdSchema,
  customerSchema,
  OIB_EXISTS_MESSAGE,
  type CustomerInput,
} from './schemas'
import { listCustomers, type CustomerList } from './queries'

// Customer actions (plan: "Server actions"). Any member of the organization may create, edit,
// archive and restore. Same shape as the organization actions: authorization first, then zod,
// then the change and its audit row in one tenant transaction. Audit rows hold field NAMES only;
// customer data (names, OIBs, addresses, e-mails) is never logged.
//
// Customers are archived, never deleted (pf_app has no DELETE grant). This is a 'use server'
// module: every export is a public endpoint and takes `unknown`.

const BAD_INPUT = 'Provjerite označena polja.'
const NOT_FOUND_MESSAGE = 'Kupac ne postoji.'
const OIB_INDEX = 'customers_organization_id_oib_active_uidx'

/** Thrown inside a transaction to roll it back and return `failure` to the caller. */
class Abort extends Error {
  constructor(readonly failure: ActionFailure) {
    super('action aborted')
  }
}

const duplicateOib = () => fail(OIB_EXISTS_MESSAGE, { oib: OIB_EXISTS_MESSAGE })

function slugOf(input: unknown): string {
  const slug = (input as { orgSlug?: unknown } | null | undefined)?.orgSlug
  return typeof slug === 'string' ? slug : ''
}

function revalidateCustomers(orgSlug: string, customerId?: string) {
  revalidatePath(`/app/${orgSlug}/kupci`)
  if (customerId) revalidatePath(`/app/${orgSlug}/kupci/${customerId}`)
}

/** Runs the write in a tenant transaction; an Abort (or a unique OIB clash) becomes a failure. */
async function inTenant<T>(
  ctx: OrgContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<{ ok: true; value: T } | ActionFailure> {
  try {
    return { ok: true, value: await withTenant(ctx, fn) }
  } catch (error) {
    if (error instanceof Abort) return error.failure
    // Two requests racing for the same OIB: the partial unique index decides.
    if (isUniqueViolation(error, OIB_INDEX)) return duplicateOib()
    throw error
  }
}

/** Parses the customer fields of an action input (extra keys such as orgSlug are ignored). */
function parseFields(input: unknown) {
  return customerSchema.safeParse(input)
}

export async function createCustomer(
  input: unknown,
): Promise<ActionResult<{ customerId: string }>> {
  return runAction('customer.created', async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const { ctx } = gate
    const parsed = parseFields(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const data = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      await assertOibFree(tx, ctx, data.oib, null)
      const [row] = await tx
        .insert(customers)
        .values({ ...data, organizationId: orgIdOf(ctx) })
        .returning({ id: customers.id })
      if (!row) throw new Error('customer insert returned no row')
      await recordAudit(tx, ctx, {
        action: 'customer.created',
        entityType: 'customer',
        entityId: row.id,
        changedFields: Object.keys(data) as (keyof CustomerInput)[],
      })
      return row.id
    })
    if (!result.ok) return result
    revalidateCustomers(ctx.orgSlug)
    return ok({ customerId: result.value })
  })
}

/** Refuses an OIB that another ACTIVE customer of the organization already has. */
async function assertOibFree(
  tx: Tx,
  ctx: OrgContext,
  oib: string | null,
  exceptId: string | null,
): Promise<void> {
  if (oib === null) return
  const rows = await tx
    .select({ id: customers.id, archivedAt: customers.archivedAt })
    .from(customers)
    .where(and(eq(customers.organizationId, orgIdOf(ctx)), eq(customers.oib, oib)))
  if (rows.some((row) => row.archivedAt === null && row.id !== exceptId)) {
    throw new Abort(duplicateOib())
  }
}

export async function updateCustomer(
  input: unknown,
): Promise<ActionResult<{ customerId: string }>> {
  return runAction('customer.updated', async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const { ctx } = gate
    const id = customerIdSchema.safeParse((input as { customerId?: unknown } | null)?.customerId)
    if (!id.success) return fail(NOT_FOUND_MESSAGE)
    const customerId = id.data
    const parsed = parseFields(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const next = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      const [current] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.organizationId, orgIdOf(ctx)), eq(customers.id, customerId)))
        .limit(1)
        .for('update')
      if (!current) throw new Abort(fail(NOT_FOUND_MESSAGE))
      if (current.archivedAt !== null) throw new Abort(fail(ARCHIVED_MESSAGE))

      const fields = Object.keys(next) as (keyof CustomerInput)[]
      const changed = fields.filter((key) => (current[key] ?? null) !== next[key])
      if (changed.length === 0) return
      await assertOibFree(tx, ctx, next.oib, customerId)
      await tx
        .update(customers)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(customers.organizationId, orgIdOf(ctx)), eq(customers.id, customerId)))
      await recordAudit(tx, ctx, {
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        changedFields: changed,
      })
    })
    if (!result.ok) return result
    revalidateCustomers(ctx.orgSlug, customerId)
    return ok({ customerId })
  })
}

async function setArchived(
  input: unknown,
  archive: boolean,
): Promise<ActionResult<Record<string, never>>> {
  const action = archive ? 'customer.archived' : 'customer.restored'
  return runAction(action, async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const { ctx } = gate
    const id = customerIdSchema.safeParse((input as { customerId?: unknown } | null)?.customerId)
    if (!id.success) return fail(NOT_FOUND_MESSAGE)
    const customerId = id.data

    const result = await inTenant(ctx, async (tx) => {
      const [current] = await tx
        .select({ archivedAt: customers.archivedAt, oib: customers.oib })
        .from(customers)
        .where(and(eq(customers.organizationId, orgIdOf(ctx)), eq(customers.id, customerId)))
        .limit(1)
        .for('update')
      if (!current) throw new Abort(fail(NOT_FOUND_MESSAGE))
      // Already in the wanted state (a double click, a second tab): nothing to change or audit.
      if ((current.archivedAt !== null) === archive) return
      // A restored customer becomes active again, so its OIB must not clash with an active one.
      if (!archive) await assertOibFree(tx, ctx, current.oib, customerId)
      await tx
        .update(customers)
        .set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(customers.organizationId, orgIdOf(ctx)), eq(customers.id, customerId)))
      await recordAudit(tx, ctx, {
        action,
        entityType: 'customer',
        entityId: customerId,
        changedFields: ['archivedAt'],
      })
    })
    if (!result.ok) return result
    revalidateCustomers(ctx.orgSlug, customerId)
    return ok({})
  })
}

export async function archiveCustomer(
  input: unknown,
): Promise<ActionResult<Record<string, never>>> {
  return setArchived(input, true)
}

export async function restoreCustomer(
  input: unknown,
): Promise<ActionResult<Record<string, never>>> {
  return setArchived(input, false)
}

/**
 * Search for the customer list. The term is a server action argument (POST body), never part of
 * a URL, because it can be an OIB or an e-mail address. Read-only: any member may call it.
 */
export async function searchCustomers(input: unknown): Promise<ActionResult<CustomerList>> {
  return runAction('customer.search', async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const raw = input as { q?: unknown; archived?: unknown; page?: unknown }
    const q = typeof raw.q === 'string' ? raw.q.trim().slice(0, 100) : ''
    const page = typeof raw.page === 'number' && Number.isInteger(raw.page) ? raw.page : 1
    return ok(await listCustomers(gate.ctx, { q, archived: raw.archived === true, page }))
  })
}
