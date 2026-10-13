import 'server-only'
import { getTableColumns } from 'drizzle-orm'
import type { Tx } from '@/server/db/tenant'
import { auditLog, customers, items, obrtProfiles } from '@/server/db/schema'
import { assertOrgContext, type OrgContext } from '@/server/auth/context'

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

/** The entity each action is about; `entityType` must match, so a mismatch fails to compile. */
export type ActionEntity = {
  'org.created': 'organization'
  'obrt_profile.updated': 'obrt_profile'
  'member.invited': 'invitation'
  'member.invitation_revoked': 'invitation'
  'member.joined': 'member'
  'member.role_changed': 'member'
  'member.removed': 'member'
  'customer.created': 'customer'
  'customer.updated': 'customer'
  'customer.archived': 'customer'
  'customer.restored': 'customer'
  'item.created': 'item'
  'item.updated': 'item'
  'item.archived': 'item'
  'item.restored': 'item'
}

/** Every action the application records (plan: `audit_log.action`). */
export type AuditAction = keyof ActionEntity

// requestId is deliberately not an input: callers (and request headers) could put anything in it.
// The column stays NULL until a server-generated correlation id exists.
export type AuditEntry<A extends AuditAction = AuditAction> = {
  action: A
  entityType: ActionEntity[A]
  /** A UUID or a Better Auth id. Never an e-mail, OIB or name (see ENTITY_ID). */
  entityId: string
  /** Field NAMES (columns of the entity) that changed. Never values (CLAUDE.md, Privacy). */
  changedFields?: readonly EntityFields[ActionEntity[A]][]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Better Auth ids are random alphanumeric strings. All-digit strings are refused (an OIB is 11
// digits) and `@` never matches the class (an e-mail address).
const AUTH_ID = /^(?!\d+$)[A-Za-z0-9]{16,64}$/

function isEntityId(value: unknown): boolean {
  return typeof value === 'string' && (UUID.test(value) || AUTH_ID.test(value))
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
export async function recordAudit<A extends AuditAction>(
  tx: Tx,
  ctx: OrgContext,
  entry: AuditEntry<A>,
): Promise<void> {
  assertOrgContext(ctx)
  if (!isEntityId(entry.entityId)) {
    // Never repeats the value: it may be an e-mail address or an OIB.
    throw new Error('recordAudit: entityId must be an entity id')
  }
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
  })
}
