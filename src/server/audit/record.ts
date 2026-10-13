import 'server-only'
import { getTableColumns } from 'drizzle-orm'
import type { Tx } from '@/server/db/tenant'
import { auditLog, customers, items, obrtProfiles } from '@/server/db/schema'
import type { OrgContext } from '@/server/auth/context'

// The audit trail is append-only and can never be erased, so what goes into `changed_fields` is
// restricted twice: by type (and a runtime allowlist) to the real column names of the entity, and
// by a shape check as a second line of defence.

/** Columns of the entity types that are Drizzle tables: the property names of the table. */
const TABLE_FIELDS = {
  obrt_profile: Object.keys(getTableColumns(obrtProfiles)),
  customer: Object.keys(getTableColumns(customers)),
  item: Object.keys(getTableColumns(items)),
} as const

/**
 * Entity types that are not ours to define (Better Auth tables), with an explicit list of the
 * fields an action can change on them. `member` and `invitation` carry no personal data in the
 * names listed; `invitation.email` is a field NAME.
 */
const EXPLICIT_FIELDS = {
  organization: ['name', 'slug'],
  member: ['role'],
  invitation: ['email', 'role', 'status'],
} as const

const ENTITY_FIELDS: Record<AuditEntity, readonly string[]> = {
  ...TABLE_FIELDS,
  ...EXPLICIT_FIELDS,
}

type FieldsOfTable<T extends { $inferSelect: object }> = keyof T['$inferSelect'] & string

type EntityFields = {
  obrt_profile: FieldsOfTable<typeof obrtProfiles>
  customer: FieldsOfTable<typeof customers>
  item: FieldsOfTable<typeof items>
  organization: (typeof EXPLICIT_FIELDS.organization)[number]
  member: (typeof EXPLICIT_FIELDS.member)[number]
  invitation: (typeof EXPLICIT_FIELDS.invitation)[number]
}

export type AuditEntity = keyof EntityFields

/** Every action the application records (plan: `audit_log.action`). */
export type AuditAction =
  | 'org.created'
  | 'obrt_profile.updated'
  | 'member.invited'
  | 'member.invitation_revoked'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.archived'
  | 'customer.restored'
  | 'item.created'
  | 'item.updated'
  | 'item.archived'
  | 'item.restored'

export type AuditEntry<E extends AuditEntity = AuditEntity> = {
  action: AuditAction
  entityType: E
  entityId: string
  /** Field NAMES (columns of the entity) that changed. Never values (CLAUDE.md, Privacy). */
  changedFields?: readonly EntityFields[E][]
  requestId?: string
}

// Second line of defence only. It accepts any identifier-shaped token, so on its own it would
// let a one-word value (a name such as `Ana`, an IBAN) through; the allowlist above is what
// keeps values out. It does reject spaces, `@`, punctuation and anything starting with a digit
// (an OIB, a date, an amount).
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/

/**
 * Writes one audit row in the caller's transaction (so it commits or rolls back with the change).
 * `tx` must come from withTenant for the same organization, otherwise row-level security
 * rejects the insert.
 */
export async function recordAudit<E extends AuditEntity>(
  tx: Tx,
  ctx: OrgContext,
  entry: AuditEntry<E>,
): Promise<void> {
  if (!Object.hasOwn(ENTITY_FIELDS, entry.entityType)) {
    throw new Error('recordAudit: unknown entity type')
  }
  const allowed = ENTITY_FIELDS[entry.entityType]
  const changedFields: string[] = [...(entry.changedFields ?? [])]
  for (const field of changedFields) {
    // The error never repeats the offending string: it may be personal data.
    if (!allowed.includes(field) || !FIELD_NAME.test(field)) {
      throw new Error('recordAudit: changedFields must contain field names of the entity')
    }
  }
  await tx.insert(auditLog).values({
    organizationId: ctx.orgId,
    actorUserId: ctx.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changedFields,
    requestId: entry.requestId ?? null,
  })
}
