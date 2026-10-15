'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { toDecimal } from '@/lib/money'
import { fail, ok, runAction, type ActionFailure, type ActionResult } from '@/server/actions/result'
import { recordAudit } from '@/server/audit/record'
import { orgIdOf, requireOrgContext, type OrgContext } from '@/server/auth/context'
import { items } from '@/server/db/schema'
import { withTenant, type Tx } from '@/server/db/tenant'
import { fieldErrors } from '@/server/org/schemas'
import { ARCHIVED_MESSAGE, itemIdSchema, itemSchema, type ItemInput } from './schemas'
import { listItems, type ItemList } from './queries'

// Item actions (plan: "Server actions"). Any member of the organization may create, edit,
// archive and restore. Same shape as the customer actions: authorization first, then zod, then
// the change and its audit row in one tenant transaction. Audit rows hold field NAMES only.
//
// Items are archived, never deleted (pf_app has no DELETE grant). This is a 'use server' module:
// every export is a public endpoint and takes `unknown`.

const BAD_INPUT = 'Provjerite označena polja.'
const NOT_FOUND_MESSAGE = 'Artikl ne postoji.'

/** Thrown inside a transaction to roll it back and return `failure` to the caller. */
class Abort extends Error {
  constructor(readonly failure: ActionFailure) {
    super('action aborted')
  }
}

function slugOf(input: unknown): string {
  const slug = (input as { orgSlug?: unknown } | null | undefined)?.orgSlug
  return typeof slug === 'string' ? slug : ''
}

function revalidateItems(orgSlug: string, itemId?: string) {
  revalidatePath(`/app/${orgSlug}/artikli`)
  if (itemId) revalidatePath(`/app/${orgSlug}/artikli/${itemId}`)
}

/** Runs the write in a tenant transaction; an Abort becomes a failure. */
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

export async function createItem(input: unknown): Promise<ActionResult<{ itemId: string }>> {
  return runAction('item.created', async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const { ctx } = gate
    const parsed = itemSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const data = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({ ...data, organizationId: orgIdOf(ctx) })
        .returning({ id: items.id })
      if (!row) throw new Error('item insert returned no row')
      await recordAudit(tx, ctx, {
        action: 'item.created',
        entityType: 'item',
        entityId: row.id,
        changedFields: Object.keys(data) as (keyof ItemInput)[],
      })
      return row.id
    })
    if (!result.ok) return result
    revalidateItems(ctx.orgSlug)
    return ok({ itemId: result.value })
  })
}

export async function updateItem(input: unknown): Promise<ActionResult<{ itemId: string }>> {
  return runAction('item.updated', async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const { ctx } = gate
    const id = itemIdSchema.safeParse((input as { itemId?: unknown } | null)?.itemId)
    if (!id.success) return fail(NOT_FOUND_MESSAGE)
    const itemId = id.data
    const parsed = itemSchema.safeParse(input)
    if (!parsed.success) return fail(BAD_INPUT, fieldErrors(parsed.error))
    const next = parsed.data

    const result = await inTenant(ctx, async (tx) => {
      const [current] = await tx
        .select()
        .from(items)
        .where(and(eq(items.organizationId, orgIdOf(ctx)), eq(items.id, itemId)))
        .limit(1)
        .for('update')
      if (!current) throw new Abort(fail(NOT_FOUND_MESSAGE))
      if (current.archivedAt !== null) throw new Abort(fail(ARCHIVED_MESSAGE))

      const fields = Object.keys(next) as (keyof ItemInput)[]
      const changed = fields.filter((key) =>
        // numeric(19,6) comes back as "0.125000": compare as exact decimals, not strings.
        key === 'unitPrice'
          ? !toDecimal(current.unitPrice).eq(toDecimal(next.unitPrice))
          : (current[key] ?? null) !== next[key],
      )
      if (changed.length === 0) return
      await tx
        .update(items)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(items.organizationId, orgIdOf(ctx)), eq(items.id, itemId)))
      await recordAudit(tx, ctx, {
        action: 'item.updated',
        entityType: 'item',
        entityId: itemId,
        changedFields: changed,
      })
    })
    if (!result.ok) return result
    revalidateItems(ctx.orgSlug, itemId)
    return ok({ itemId })
  })
}

async function setArchived(
  input: unknown,
  archive: boolean,
): Promise<ActionResult<Record<string, never>>> {
  const action = archive ? 'item.archived' : 'item.restored'
  return runAction(action, async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const { ctx } = gate
    const id = itemIdSchema.safeParse((input as { itemId?: unknown } | null)?.itemId)
    if (!id.success) return fail(NOT_FOUND_MESSAGE)
    const itemId = id.data

    const result = await inTenant(ctx, async (tx) => {
      const [current] = await tx
        .select({ archivedAt: items.archivedAt })
        .from(items)
        .where(and(eq(items.organizationId, orgIdOf(ctx)), eq(items.id, itemId)))
        .limit(1)
        .for('update')
      if (!current) throw new Abort(fail(NOT_FOUND_MESSAGE))
      // Already in the wanted state (a double click, a second tab): nothing to change or audit.
      if ((current.archivedAt !== null) === archive) return
      await tx
        .update(items)
        .set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(items.organizationId, orgIdOf(ctx)), eq(items.id, itemId)))
      await recordAudit(tx, ctx, {
        action,
        entityType: 'item',
        entityId: itemId,
        changedFields: ['archivedAt'],
      })
    })
    if (!result.ok) return result
    revalidateItems(ctx.orgSlug, itemId)
    return ok({})
  })
}

export async function archiveItem(input: unknown): Promise<ActionResult<Record<string, never>>> {
  return setArchived(input, true)
}

export async function restoreItem(input: unknown): Promise<ActionResult<Record<string, never>>> {
  return setArchived(input, false)
}

/**
 * Search for the item list. The term is a server action argument (POST body), never part of a
 * URL. Read-only: any member may call it.
 */
export async function searchItems(input: unknown): Promise<ActionResult<ItemList>> {
  return runAction('item.search', async () => {
    const gate = await requireOrgContext(slugOf(input))
    if (!gate.ok) return gate
    const raw = input as { q?: unknown; archived?: unknown; page?: unknown }
    const q = typeof raw.q === 'string' ? raw.q.trim().slice(0, 100) : ''
    const page =
      typeof raw.page === 'number' &&
      Number.isInteger(raw.page) &&
      raw.page >= 1 &&
      raw.page <= 1_000_000
        ? raw.page
        : 1
    return ok(await listItems(gate.ctx, { q, archived: raw.archived === true, page }))
  })
}
