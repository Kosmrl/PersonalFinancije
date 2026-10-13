import 'server-only'
import { sql } from 'drizzle-orm'
import { boolean, char, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { organization } from './auth'

// One row per organization (the obrt), created during onboarding. Tenant table: row-level
// security (ENABLE + FORCE, policy on organization_id = app.org_id) and the pf_app grants are in
// the custom migration drizzle/*_rls_grants_audit.sql; only withTenant() may touch it.
// Plan: docs/plans/2026-10-09-phase-1-foundation.md, "obrt_profiles".
//
// Format rules (OIB check digit, IBAN mod-97, postal code, lengths) are validated with zod in the
// actions; the database enforces only the structural ones below.
export const obrtProfiles = pgTable(
  'obrt_profiles',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id),
    tradeName: text('trade_name').notNull(),
    ownerFullName: text('owner_full_name').notNull(),
    // One obrt per OIB across all organizations. The cross-tenant existence check goes through
    // the SECURITY DEFINER function oib_is_registered(), never a direct SELECT.
    oib: char('oib', { length: 11 }).notNull().unique(),
    street: text('street').notNull(),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull().default('HR'),
    iban: text('iban').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    website: text('website'),
    inVatSystem: boolean('in_vat_system').notNull().default(false),
    defaultInvoiceNote: text('default_invoice_note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by the application on update.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // MVP: only pausalisti outside the VAT system (plan, "obrt_profiles").
    check('obrt_profiles_not_in_vat_system', sql`${table.inVatSystem} = false`),
  ],
)

export type ObrtProfile = typeof obrtProfiles.$inferSelect
export type NewObrtProfile = typeof obrtProfiles.$inferInsert
