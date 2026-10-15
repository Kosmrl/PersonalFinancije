import 'server-only'
import { and, asc, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { orgIdOf, type OrgContext } from '@/server/auth/context'
import { withTenant } from '@/server/db/tenant'
import { customers } from '@/server/db/schema'
import { customerIdSchema } from './schemas'

// Reads for the customer pages. Everything runs through withTenant with an explicit organization
// filter on top of row-level security (see the note in org/actions.ts).

export type { Customer } from '@/server/db/schema'

export const CUSTOMERS_PAGE_SIZE = 50

/** Escapes LIKE metacharacters so user input is matched literally (`50%` is not a wildcard). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export type CustomerListRow = {
  id: string
  kind: string
  name: string
  oib: string | null
  vatId: string | null
  city: string | null
  countryCode: string
  email: string | null
  archived: boolean
}

export type CustomerList = {
  rows: CustomerListRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * Customers of the organization, 50 per page, ordered by lower(name). `q` matches name, OIB or
 * e-mail case-insensitively. Archived customers are hidden unless `archived` is true, which
 * shows them together with the active ones.
 */
export async function listCustomers(
  ctx: OrgContext,
  options: { q?: string; archived?: boolean; page?: number } = {},
): Promise<CustomerList> {
  const page = Number.isInteger(options.page) && options.page! >= 1 ? options.page! : 1
  const q = options.q?.trim().slice(0, 100) ?? ''

  return withTenant(ctx, async (tx) => {
    const conditions: SQL[] = [eq(customers.organizationId, orgIdOf(ctx))]
    if (!options.archived) conditions.push(isNull(customers.archivedAt))
    if (q) {
      const pattern = `%${escapeLike(q)}%`
      conditions.push(
        or(
          sql`${customers.name} ilike ${pattern} escape '\\'`,
          sql`${customers.oib}::text ilike ${pattern} escape '\\'`,
          sql`${customers.email} ilike ${pattern} escape '\\'`,
        )!,
      )
    }
    const where = and(...conditions)

    const [totalRow] = await tx.select({ value: count() }).from(customers).where(where)
    const rows = await tx
      .select({
        id: customers.id,
        kind: customers.kind,
        name: customers.name,
        oib: customers.oib,
        vatId: customers.vatId,
        city: customers.city,
        countryCode: customers.countryCode,
        email: customers.email,
        archivedAt: customers.archivedAt,
      })
      .from(customers)
      .where(where)
      .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
      .limit(CUSTOMERS_PAGE_SIZE)
      .offset((page - 1) * CUSTOMERS_PAGE_SIZE)

    return {
      rows: rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null })),
      total: totalRow?.value ?? 0,
      page,
      pageSize: CUSTOMERS_PAGE_SIZE,
    }
  })
}

/** One customer of the organization; `notFound()` when missing or not a valid id. */
export async function getCustomer(ctx: OrgContext, id: string) {
  const parsed = customerIdSchema.safeParse(id)
  if (!parsed.success) notFound()
  const row = await withTenant(ctx, async (tx) => {
    const [found] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, orgIdOf(ctx)), eq(customers.id, parsed.data)))
      .limit(1)
    return found ?? null
  })
  if (!row) notFound()
  return row
}
