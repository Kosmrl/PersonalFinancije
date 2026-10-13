import 'server-only'
import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization } from './auth'

// Tenant table (RLS in the custom migration; only withTenant() may touch it).
// Plan: "customers". Archiving replaces deletion, so pf_app has no DELETE grant.
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    // Not collected for persons by default (data minimisation). Required for HR businesses.
    oib: char('oib', { length: 11 }),
    vatId: text('vat_id'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    countryCode: char('country_code', { length: 2 }).notNull().default('HR'),
    email: text('email'),
    note: text('note'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Target for composite foreign keys from later tables (documents reference customers).
    unique('customers_organization_id_id_unique').on(table.organizationId, table.id),
    // One active customer per OIB within an organization; archived ones do not count.
    uniqueIndex('customers_organization_id_oib_active_uidx')
      .on(table.organizationId, table.oib)
      .where(sql`${table.oib} is not null and ${table.archivedAt} is null`),
    index('customers_organization_id_lower_name_idx').on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    // Structural format only (defence in depth); NULL passes. The OIB check digit is validated in
    // the actions.
    check('customers_oib_format', sql`${table.oib} ~ '^[0-9]{11}$'`),
    check('customers_country_code_format', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
    check('customers_kind_check', sql`${table.kind} in ('person', 'business')`),
    check(
      'customers_hr_business_requires_oib',
      sql`not (${table.kind} = 'business' and ${table.countryCode} = 'HR' and ${table.oib} is null)`,
    ),
  ],
)

export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
