import 'server-only'
import { and, asc, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { orgIdOf, type OrgContext } from '@/server/auth/context'
import { withTenant } from '@/server/db/tenant'
import { items } from '@/server/db/schema'
import { escapeLike } from '@/server/customers/queries'
import { itemIdSchema } from './schemas'

// Reads for the item pages. Everything runs through withTenant with an explicit organization
// filter on top of row-level security (same as customers/queries.ts).

export type { Item } from '@/server/db/schema'

export const ITEMS_PAGE_SIZE = 50

export type ItemListRow = {
  id: string
  name: string
  unitCode: string
  /** Decimal STRING from numeric(19,6), e.g. "0.125000". Never convert to a number. */
  unitPrice: string
  currency: string
  kpdCode: string | null
  archived: boolean
}

export type ItemList = {
  rows: ItemListRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * Items of the organization, 50 per page, ordered by lower(name). `q` matches name, description
 * or KPD code case-insensitively. Archived items are hidden unless `archived` is true, which
 * shows them together with the active ones.
 */
export async function listItems(
  ctx: OrgContext,
  options: { q?: string; archived?: boolean; page?: number } = {},
): Promise<ItemList> {
  const page = Number.isInteger(options.page) && options.page! >= 1 ? options.page! : 1
  const q = options.q?.trim().slice(0, 100) ?? ''

  return withTenant(ctx, async (tx) => {
    const conditions: SQL[] = [eq(items.organizationId, orgIdOf(ctx))]
    if (!options.archived) conditions.push(isNull(items.archivedAt))
    if (q) {
      const pattern = `%${escapeLike(q)}%`
      const matches: SQL[] = [
        sql`${items.name} ilike ${pattern} escape '\\'`,
        sql`${items.description} ilike ${pattern} escape '\\'`,
        sql`${items.kpdCode}::text ilike ${pattern} escape '\\'`,
      ]
      // KPD codes are stored without dots but shown as 62.01.11, so a numeric term with dots or
      // spaces is also matched against the code with those stripped.
      if (/^[\d.\s]+$/.test(q)) {
        const digits = q.replace(/[.\s]/g, '')
        if (digits) matches.push(sql`${items.kpdCode}::text ilike ${`%${digits}%`}`)
      }
      conditions.push(or(...matches)!)
    }
    const where = and(...conditions)

    const [totalRow] = await tx.select({ value: count() }).from(items).where(where)
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        unitCode: items.unitCode,
        unitPrice: items.unitPrice,
        currency: items.currency,
        kpdCode: items.kpdCode,
        archivedAt: items.archivedAt,
      })
      .from(items)
      .where(where)
      .orderBy(asc(sql`lower(${items.name})`), asc(items.id))
      .limit(ITEMS_PAGE_SIZE)
      .offset((page - 1) * ITEMS_PAGE_SIZE)

    return {
      rows: rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null })),
      total: totalRow?.value ?? 0,
      page,
      pageSize: ITEMS_PAGE_SIZE,
    }
  })
}

/** One item of the organization; `notFound()` when missing or not a valid id. */
export async function getItem(ctx: OrgContext, id: string) {
  const parsed = itemIdSchema.safeParse(id)
  if (!parsed.success) notFound()
  const row = await withTenant(ctx, async (tx) => {
    const [found] = await tx
      .select()
      .from(items)
      .where(and(eq(items.organizationId, orgIdOf(ctx)), eq(items.id, parsed.data)))
      .limit(1)
    return found ?? null
  })
  if (!row) notFound()
  return row
}
