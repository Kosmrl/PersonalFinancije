import 'server-only'
import { createAccessControl } from 'better-auth/plugins/access'

// Roles of the Better Auth organization plugin (plan: Role matrix). Only the plugin's own
// resources are listed. Customers and items are plain tenant data, checked by
// requireOrgContext in the server actions, not through these statements.
//
// The Better Auth HTTP endpoints (/api/auth/organization/*) are reachable by any signed-in
// browser, so these statements are the real gate for inviting, removing and changing members:
// only the owner may do it, accountant and member hold no administrative permission.
export const statement = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
} as const

export const ac = createAccessControl(statement)

export const owner = ac.newRole({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
})

// Accountant and member: no organization or membership administration.
export const accountant = ac.newRole({ organization: [], member: [], invitation: [] })
export const member = ac.newRole({ organization: [], member: [], invitation: [] })

export const roles = { owner, accountant, member }
