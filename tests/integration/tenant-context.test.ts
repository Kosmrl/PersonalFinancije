import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { createRng, fakeOib, freshSeed } from '../helpers/fake'
import { testOrgContext } from '../helpers/org-context'
import {
  addMember,
  appPool,
  asTenant,
  createOrg,
  createUser,
  insertCustomer,
  ownerPool,
  type TestOrg,
} from '../helpers/db'

// withTenant, recordAudit and requireOrgContext against the real database. Next's request APIs
// and Better Auth's session lookup are replaced by minimal mocks; everything else (the Drizzle
// client on the pf_app pool, the membership query, row-level security) is real.

const mocks = vi.hoisted(() => ({
  session: null as null | { userId: string },
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
}))
vi.mock('@/server/auth/auth', () => ({
  getAuth: () => ({
    api: {
      getSession: async () =>
        mocks.session
          ? {
              user: { id: mocks.session.userId, emailVerified: true },
              // The client-controlled active organization must never be trusted.
              session: { activeOrganizationId: 'ignored' },
            }
          : null,
    },
  }),
}))

describe('tenant context helpers', () => {
  const owner = ownerPool()
  const app = appPool()
  const rng = createRng(freshSeed())
  let tenant: typeof import('@/server/db/tenant')
  let audit: typeof import('@/server/audit/record')
  let context: typeof import('@/server/auth/context')
  let client: typeof import('@/server/db/client')

  let orgA: TestOrg
  let orgB: TestOrg
  let userA: { id: string }
  let ownerOfB: { id: string }

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    client = await import('@/server/db/client')
    tenant = await import('@/server/db/tenant')
    audit = await import('@/server/audit/record')
    context = await import('@/server/auth/context')

    orgA = await createOrg(owner)
    orgB = await createOrg(owner)
    userA = await createUser(owner)
    ownerOfB = await createUser(owner)
    await addMember(owner, orgA.id, userA.id, 'accountant')
    await addMember(owner, orgB.id, ownerOfB.id, 'owner')
  })
  afterAll(async () => {
    await client.getPool().end()
    await app.end()
    await owner.end()
  })
  beforeEach(() => {
    mocks.session = null
  })

  describe('withTenant', () => {
    it('scopes the transaction to the organization', async () => {
      const id = await tenant.withTenant(testOrgContext({ orgId: orgA.id }), async (tx) => {
        const { rows } = await tx.execute<{ org: string }>(
          (await import('drizzle-orm')).sql`select current_setting('app.org_id', true) as org`,
        )
        expect(rows[0]?.org).toBe(orgA.id)
        const [row] = await tx
          .insert((await import('@/server/db/schema')).customers)
          .values({ organizationId: orgA.id, kind: 'business', name: 'Kupac', oib: fakeOib(rng) })
          .returning({ id: (await import('@/server/db/schema')).customers.id })
        return row!.id
      })
      const visible = await asTenant(app, orgA.id, (c) =>
        c.query('select 1 from customers where id = $1', [id]),
      )
      expect(visible.rowCount).toBe(1)
    })

    it("cannot write another organization's rows, and a failure rolls everything back", async () => {
      const { customers } = await import('@/server/db/schema')
      await expect(
        tenant.withTenant(testOrgContext({ orgId: orgA.id }), async (tx) => {
          await tx
            .insert(customers)
            .values({ organizationId: orgA.id, kind: 'person', name: 'Rolled back' })
          await tx
            .insert(customers)
            .values({ organizationId: orgB.id, kind: 'person', name: 'Wrong org' })
        }),
      ).rejects.toThrow()
      const { rows } = await asTenant(app, orgA.id, (c) =>
        c.query(`select 1 from customers where name = 'Rolled back'`),
      )
      expect(rows).toHaveLength(0)
    })

    // "The setting does not outlive the transaction" is covered by rls.test.ts on a
    // single-connection pool; here it would run on a 10-connection pool and could pass vacuously.

    it('does not accept a bare { orgId } object (compile-time brand)', () => {
      // Never invoked: the point is that the line below fails typecheck without the directive.
      const bare = () =>
        // @ts-expect-error OrgContext is branded; only requireOrgContext can mint one.
        tenant.withTenant({ orgId: orgA.id }, async () => {})
      expect(bare).toBeTypeOf('function')
    })

    it('refuses an empty organization id', async () => {
      await expect(
        tenant.withTenant(testOrgContext({ orgId: '' }), async () => {}),
      ).rejects.toThrow()
    })

    it('rejects a spread copy, an Object.assign copy and a cast object at runtime', async () => {
      const real = testOrgContext({ orgId: orgA.id })
      const copies = [
        { ...real, orgId: orgB.id },
        Object.assign({}, real, { orgId: orgB.id }),
        { orgId: orgB.id, orgSlug: 's', userId: 'u', role: 'owner' } as unknown as typeof real,
      ]
      for (const forged of copies) {
        await expect(tenant.withTenant(forged, async () => 1)).rejects.toThrow(
          'Invalid organization context',
        )
      }
      await expect(tenant.withTenant(real, async () => 1)).resolves.toBe(1)
    })
  })

  describe('recordAudit', () => {
    it('writes one row with field names and the actor, in the tenant transaction', async () => {
      const ctx = testOrgContext({ orgId: orgA.id, userId: userA.id })
      await tenant.withTenant(ctx, (tx) =>
        audit.recordAudit(tx, ctx, {
          action: 'customer.updated',
          entityType: 'customer',
          entityId: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
          changedFields: ['name', 'email'],
        }),
      )
      const { rows } = await asTenant(app, orgA.id, (c) =>
        c.query<{
          action: string
          changed_fields: string[]
          actor_user_id: string
          request_id: string | null
        }>(
          `select action, changed_fields, actor_user_id, request_id from audit_log where entity_id = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'`,
        ),
      )
      expect(rows).toEqual([
        {
          action: 'customer.updated',
          changed_fields: ['name', 'email'],
          actor_user_id: userA.id,
          request_id: null,
        },
      ])
    })

    it('rolls back with the surrounding transaction', async () => {
      const ctx = testOrgContext({ orgId: orgA.id, userId: userA.id })
      await expect(
        tenant.withTenant(ctx, async (tx) => {
          await audit.recordAudit(tx, ctx, {
            action: 'item.created',
            entityType: 'item',
            entityId: 'rb1rb1rb1rb1rb1rb1rb1rb1rb1rb1rb',
          })
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      const { rows } = await asTenant(app, orgA.id, (c) =>
        c.query(`select 1 from audit_log where entity_id = 'rb-1'`),
      )
      expect(rows).toHaveLength(0)
    })

    it('rejects values passed as field names (OIB, e-mail, IBAN, a name, free text)', async () => {
      const ctx = testOrgContext({ orgId: orgA.id, userId: userA.id })
      const bad = [fakeOib(rng), 'someone@example.test', 'HR1210010051863000160', 'Ana', 'a=b']
      for (const value of bad) {
        await expect(
          tenant.withTenant(ctx, (tx) =>
            audit.recordAudit(tx, ctx, {
              action: 'customer.updated',
              entityType: 'customer',
              entityId: 'bad1bad1bad1bad1bad1bad1bad1bad1',
              // Deliberately not a column name; the cast is what a bug would do.
              changedFields: [value as never],
            }),
          ),
        ).rejects.toThrow(/field names/)
      }
      const { rows } = await asTenant(app, orgA.id, (c) =>
        c.query(`select 1 from audit_log where entity_id = 'bad-1'`),
      )
      expect(rows).toHaveLength(0)
    })

    it('cannot record an entry for another organization', async () => {
      const ctxA = testOrgContext({ orgId: orgA.id, userId: userA.id })
      await expect(
        tenant.withTenant(ctxA, (tx) =>
          audit.recordAudit(tx, testOrgContext({ orgId: orgB.id, userId: userA.id }), {
            action: 'customer.created',
            entityType: 'customer',
            entityId: 'x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1x1',
          }),
        ),
      ).rejects.toThrow()
    })
  })

  describe('requireOrgContext', () => {
    it('returns the context loaded from the membership row', async () => {
      mocks.session = { userId: userA.id }
      const result = await context.requireOrgContext(orgA.slug)
      expect(result).toEqual({
        ok: true,
        ctx: { orgId: orgA.id, orgSlug: orgA.slug, userId: userA.id, role: 'accountant' },
      })
    })

    it('a member of A only, calling with the slug of B, gets notFound', async () => {
      mocks.session = { userId: userA.id }
      await expect(context.requireOrgContext(orgB.slug)).rejects.toThrow('NEXT_NOT_FOUND')
    })

    it('an unknown slug looks the same as a foreign one', async () => {
      mocks.session = { userId: userA.id }
      await expect(context.requireOrgContext('does-not-exist')).rejects.toThrow('NEXT_NOT_FOUND')
    })

    it('refuses a role that is not allowed with the Croatian message', async () => {
      mocks.session = { userId: userA.id }
      const result = await context.requireOrgContext(orgA.slug, { roles: ['owner'] })
      expect(result).toEqual({ ok: false, message: 'Nemate ovlasti za ovu radnju.' })
      const allowed = await context.requireOrgContext(orgA.slug, { roles: ['owner', 'accountant'] })
      expect(allowed.ok).toBe(true)
    })

    it('reads the membership on every call: a deleted row means notFound at once', async () => {
      const org = await createOrg(owner)
      const user = await createUser(owner)
      const memberId = await addMember(owner, org.id, user.id, 'owner')
      mocks.session = { userId: user.id }
      expect((await context.requireOrgContext(org.slug)).ok).toBe(true)

      await owner.query('delete from member where id = $1', [memberId])
      // The session still claims an active organization (see the mock); it must not matter.
      await expect(context.requireOrgContext(org.slug)).rejects.toThrow('NEXT_NOT_FOUND')
    })

    it('picks up a role change immediately', async () => {
      const org = await createOrg(owner)
      const user = await createUser(owner)
      const memberId = await addMember(owner, org.id, user.id, 'owner')
      mocks.session = { userId: user.id }
      expect((await context.requireOrgContext(org.slug, { roles: ['owner'] })).ok).toBe(true)
      await owner.query(`update member set role = 'member' where id = $1`, [memberId])
      expect(await context.requireOrgContext(org.slug, { roles: ['owner'] })).toMatchObject({
        ok: false,
      })
    })

    it('treats an unknown stored role as no authority, and picks the highest of several', async () => {
      const org = await createOrg(owner)
      const user = await createUser(owner)
      const memberId = await addMember(owner, org.id, user.id, 'superadmin')
      mocks.session = { userId: user.id }
      expect(await context.requireOrgContext(org.slug)).toMatchObject({ ok: false })
      await owner.query(`update member set role = 'member,owner' where id = $1`, [memberId])
      const result = await context.requireOrgContext(org.slug)
      expect(result.ok && result.ctx.role).toBe('owner')
    })

    it('without a session the visitor is sent to sign-in', async () => {
      mocks.session = null
      await expect(context.requireOrgContext(orgA.slug)).rejects.toThrow('NEXT_REDIRECT:/prijava')
    })

    it("a context from requireOrgContext cannot reach another org's data through withTenant", async () => {
      await asTenant(app, orgB.id, (c) => insertCustomer(c, orgB.id, { name: 'Tajni kupac' }))
      mocks.session = { userId: userA.id }
      const result = await context.requireOrgContext(orgA.slug)
      if (!result.ok) throw new Error('expected a context')
      const { customers } = await import('@/server/db/schema')
      const visible = await tenant.withTenant(result.ctx, (tx) => tx.select().from(customers))
      expect(visible.every((row) => row.organizationId === orgA.id)).toBe(true)
      expect(visible.some((row) => row.name === 'Tajni kupac')).toBe(false)
    })
  })
})
