import 'server-only'
import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Append-only audit trail. Tenant table: RLS has SELECT and INSERT policies only, pf_app is
// granted SELECT and INSERT only, and a BEFORE UPDATE OR DELETE trigger (forbid_mutation) raises
// for everybody, including the owner. All in the custom migration.
//
// changed_fields holds field NAMES only, never values (CLAUDE.md, Privacy). There is no foreign
// key on purpose: the trail must outlive whatever it refers to.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text('organization_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    changedFields: text('changed_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    requestId: text('request_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_organization_id_occurred_at_idx').on(
      table.organizationId,
      table.occurredAt.desc(),
    ),
  ],
)

export type AuditLogRow = typeof auditLog.$inferSelect
export type NewAuditLogRow = typeof auditLog.$inferInsert
