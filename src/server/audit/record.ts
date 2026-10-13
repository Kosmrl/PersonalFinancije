import 'server-only'
import type { Tx } from '@/server/db/tenant'
import { auditLog } from '@/server/db/schema'
import type { OrgContext } from '@/server/auth/context'

export type AuditEntry = {
  /** e.g. `customer.created`, `obrt_profile.updated`, `member.role_changed`. */
  action: string
  entityType: string
  entityId: string
  /** Field NAMES that changed. Never values (CLAUDE.md, Privacy). */
  changedFields?: readonly string[]
  requestId?: string
}

// Names only: an identifier-like token. A value such as an OIB, e-mail or trade name does not
// match, so passing values by mistake fails loudly instead of landing in the audit trail.
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/

/**
 * Writes one audit row in the caller's transaction (so it commits or rolls back with the change).
 * `tx` must come from withTenant for the same organization, otherwise row-level security
 * rejects the insert.
 */
export async function recordAudit(
  tx: Tx,
  ctx: Pick<OrgContext, 'orgId' | 'userId'>,
  entry: AuditEntry,
): Promise<void> {
  const changedFields = [...(entry.changedFields ?? [])]
  for (const field of changedFields) {
    if (!FIELD_NAME.test(field)) {
      throw new Error('recordAudit: changedFields must contain field names, not values')
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
