import 'server-only'
import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization } from './auth'

// Products and services. Tenant table (RLS in the custom migration; only withTenant() may touch
// it). Plan: "items".
//
// unit_price is a UNIT price, which CLAUDE.md allows to be more precise than cents. It is
// numeric(19,6) and Drizzle reads and writes it as a decimal STRING; never convert it to a JS
// number. Line totals are computed with decimal.js (src/lib/money) and rounded once.
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    description: text('description'),
    // UN/ECE Recommendation 20 code from src/server/items/units.ts (validated with zod).
    unitCode: text('unit_code').notNull(),
    unitPrice: numeric('unit_price', { precision: 19, scale: 6 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    // Six digits without dots (62.01.11 is stored as 620111).
    kpdCode: char('kpd_code', { length: 6 }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('items_organization_id_id_unique').on(table.organizationId, table.id),
    index('items_organization_id_lower_name_idx').on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    check('items_unit_price_non_negative', sql`${table.unitPrice} >= 0`),
    // Structural formats (defence in depth); a NULL kpd_code passes.
    check('items_currency_format', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('items_kpd_code_format', sql`${table.kpdCode} ~ '^[0-9]{6}$'`),
  ],
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
