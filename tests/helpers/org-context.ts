// Test-only factory for the branded OrgContext. Production code gets a context only from
// requireOrgContext (it reads the membership); tests that exercise withTenant or recordAudit
// directly build one here from made-up ids.

import { mintOrgContextForTests, type OrgContext, type OrgRole } from '@/server/auth/context'

export function testOrgContext(fields: {
  orgId: string
  userId?: string
  orgSlug?: string
  role?: OrgRole
}): OrgContext {
  return mintOrgContextForTests({
    orgId: fields.orgId,
    orgSlug: fields.orgSlug ?? 'test-org',
    userId: fields.userId ?? 'u_test',
    role: fields.role ?? 'owner',
  })
}
