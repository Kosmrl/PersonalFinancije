import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import {
  addMember,
  appPool,
  asTenant,
  createOrg,
  createUser,
  insertCustomer,
  insertItem,
  ownerPool,
} from '../helpers/db'
import { testOrgContext } from '../helpers/org-context'

// getOnboardingCounts: the dashboard checklist reads counts only, scoped to the organization.

describe('getOnboardingCounts', () => {
  const owner = ownerPool()
  const app = appPool()
  let queries: typeof import('@/server/org/queries')
  let client: typeof import('@/server/db/client')

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    process.env.BETTER_AUTH_SECRET = randomBytes(24).toString('hex')
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.SMTP_HOST = 'localhost'
    process.env.MAIL_FROM = 'test@example.test'
    queries = await import('@/server/org/queries')
    client = await import('@/server/db/client')
  })
  afterAll(async () => {
    await client.getPool().end()
    await app.end()
    await owner.end()
  })

  async function tenant() {
    const org = await createOrg(owner)
    const user = await createUser(owner)
    await addMember(owner, org.id, user.id, 'owner')
    return {
      orgId: org.id,
      ctx: testOrgContext({ orgId: org.id, orgSlug: org.slug, userId: user.id, role: 'owner' }),
    }
  }

  it('is zero for a new organization', async () => {
    const a = await tenant()
    expect(await queries.getOnboardingCounts(a.ctx)).toEqual({ customers: 0, items: 0 })
  })

  it('counts only the own organization and includes archived rows', async () => {
    const a = await tenant()
    const b = await tenant()
    await asTenant(app, a.orgId, async (c) => {
      await insertCustomer(c, a.orgId, { name: 'Kupac A1' })
      const archived = await insertCustomer(c, a.orgId, { name: 'Kupac A2' })
      await c.query(`update customers set archived_at = now() where id = $1`, [archived])
      await insertItem(c, a.orgId)
    })
    await asTenant(app, b.orgId, async (c) => {
      await insertCustomer(c, b.orgId, { name: 'Kupac B1' })
      await insertItem(c, b.orgId)
      await insertItem(c, b.orgId)
      await insertItem(c, b.orgId)
    })
    expect(await queries.getOnboardingCounts(a.ctx)).toEqual({ customers: 2, items: 1 })
    expect(await queries.getOnboardingCounts(b.ctx)).toEqual({ customers: 1, items: 3 })
  })
})
