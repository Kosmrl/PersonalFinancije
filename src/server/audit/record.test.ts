import { describe, expect, it, vi } from 'vitest'
import { assertOrgContext, OrgContextError, orgIdOf } from '@/server/auth/context'
import type { Tx } from '@/server/db/tenant'
import { testOrgContext } from '../../../tests/helpers/org-context'
import { recordAudit } from './record'

// Made-up values only. The transaction is a stub that captures the inserted row.
const FAKE_OIB = '12345678903'
const FAKE_IBAN = 'HR1210010051863000160'

const ctx = testOrgContext({ orgId: 'o_1', userId: 'u_1' })
const ID = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6' // a Better Auth style id

function stubTx() {
  const values = vi.fn().mockResolvedValue(undefined)
  const tx = { insert: vi.fn(() => ({ values })) } as unknown as Tx
  return { tx, values }
}

describe('recordAudit: changedFields', () => {
  it('stores real column names of the entity', async () => {
    const { tx, values } = stubTx()
    await recordAudit(tx, ctx, {
      action: 'obrt_profile.updated',
      entityType: 'obrt_profile',
      entityId: ID,
      changedFields: ['tradeName', 'iban', 'defaultInvoiceNote'],
    })
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'o_1',
        actorUserId: 'u_1',
        action: 'obrt_profile.updated',
        entityType: 'obrt_profile',
        changedFields: ['tradeName', 'iban', 'defaultInvoiceNote'],
      }),
    )
  })

  it('accepts the explicit allowlists of organization, member and invitation', async () => {
    const { tx, values } = stubTx()
    await recordAudit(tx, ctx, {
      action: 'member.role_changed',
      entityType: 'member',
      entityId: ID,
      changedFields: ['role'],
    })
    await recordAudit(tx, ctx, {
      action: 'org.created',
      entityType: 'organization',
      entityId: ID,
      changedFields: ['name', 'slug'],
    })
    expect(values).toHaveBeenCalledTimes(2)
  })

  it('defaults to no fields', async () => {
    const { tx, values } = stubTx()
    await recordAudit(tx, ctx, { action: 'item.archived', entityType: 'item', entityId: ID })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ changedFields: [] }))
  })

  it.each([
    ['an IBAN', FAKE_IBAN],
    ['a one-word name', 'Ana'],
    ['an OIB', FAKE_OIB],
    ['an e-mail address', 'ana@example.test'],
    ['free text', 'Marko Maric'],
    ['an unknown but identifier-shaped word', 'notAColumn'],
    ['a column of another entity', 'unitPrice'],
  ])('rejects %s as a field name', async (_label, value) => {
    const { tx, values } = stubTx()
    await expect(
      recordAudit(tx, ctx, {
        action: 'customer.updated',
        entityType: 'customer',
        entityId: ID,
        // What a bug would do: a value, or a wrong column, cast past the type.
        changedFields: [value as never],
      }),
    ).rejects.toThrow(/field names/)
    expect(values).not.toHaveBeenCalled()
  })

  it('does not repeat the offending value in the error', async () => {
    const { tx } = stubTx()
    const error = await recordAudit(tx, ctx, {
      action: 'customer.updated',
      entityType: 'customer',
      entityId: ID,
      changedFields: [FAKE_IBAN as never],
    }).catch((e: Error) => e)
    expect((error as Error).message).not.toContain(FAKE_IBAN)
  })

  it('rejects an unknown entity type at runtime', async () => {
    const { tx } = stubTx()
    await expect(
      recordAudit(tx, ctx, {
        action: 'customer.created',
        entityType: 'constructor' as never,
        entityId: ID,
      }),
    ).rejects.toThrow()
  })

  it('is type-checked against the entity columns', () => {
    const { tx } = stubTx()
    // Never invoked: this only has to compile, and the directives must each be used.
    void (() =>
      recordAudit(tx, ctx, {
        action: 'customer.updated',
        entityType: 'customer',
        entityId: ID,
        // @ts-expect-error unitPrice is a column of items, not customers
        changedFields: ['unitPrice'],
      }))
    void (() =>
      recordAudit(tx, ctx, {
        action: 'customer.created',
        // @ts-expect-error customer.created is about a customer, not an item
        entityType: 'item',
        entityId: ID,
      }))
    void (() =>
      recordAudit(tx, ctx, {
        // @ts-expect-error not one of the audited actions
        action: 'customer.exploded',
        entityType: 'customer',
        entityId: ID,
      }))
    void (() =>
      // @ts-expect-error a conditional action must not pair with an entityType of one branch
      recordAudit(tx, ctx, {
        action: Math.random() > 0.5 ? 'customer.created' : 'item.created',
        entityType: 'item',
        entityId: ID,
      }))
    expect(true).toBe(true)
  })
})

describe('recordAudit: entityId', () => {
  it.each([
    ['a UUID', '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'],
    ['a Better Auth id', ID],
  ])('accepts %s', async (_label, value) => {
    const { tx, values } = stubTx()
    await recordAudit(tx, ctx, { action: 'item.archived', entityType: 'item', entityId: value })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ entityId: value }))
  })

  it.each([
    ['an e-mail address', 'ana.horvat@example.test'],
    ['an OIB', FAKE_OIB],
    ['a long all-digit string', '1234567890123456'],
    ['a name', 'Ana Horvat'],
    ['a short id', 'c_1'],
    ['an IBAN', FAKE_IBAN],
    ['a 31-character id', ID.slice(1)],
    ['a 33-character id', ID + 'a'],
    ['an empty string', ''],
  ])('rejects %s as an entityId without repeating it', async (_label, value) => {
    const { tx, values } = stubTx()
    const error = await recordAudit(tx, ctx, {
      action: 'customer.created',
      entityType: 'customer',
      entityId: value,
    }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    if (value) expect((error as Error).message).not.toContain(value)
    expect(values).not.toHaveBeenCalled()
  })

  it('has no requestId input', () => {
    const { tx } = stubTx()
    void (() =>
      recordAudit(tx, ctx, {
        action: 'item.archived',
        entityType: 'item',
        entityId: ID,
        // @ts-expect-error requestId is not accepted from callers
        requestId: 'req-1',
      }))
    expect(true).toBe(true)
  })
})

describe('OrgContext runtime brand', () => {
  const forged = () => ({
    spread: { ...ctx, orgId: 'o_other' },
    assign: Object.assign({}, ctx, { orgId: 'o_other' }),
    cast: { orgId: 'o_other', orgSlug: 'x', userId: 'u', role: 'owner' } as unknown as typeof ctx,
  })

  it.each(['spread', 'assign', 'cast'] as const)('recordAudit rejects a %s copy', async (kind) => {
    const { tx, values } = stubTx()
    await expect(
      recordAudit(tx, forged()[kind], { action: 'item.archived', entityType: 'item', entityId: ID }),
    ).rejects.toThrow('Invalid organization context')
    expect(values).not.toHaveBeenCalled()
  })

  it('accepts a minted context and freezes it', () => {
    expect(() => assertOrgContext(ctx)).not.toThrow()
    expect(Object.isFrozen(ctx)).toBe(true)
  })

  it.each(['spread', 'assign', 'cast'] as const)('orgIdOf rejects a %s copy', (kind) => {
    expect(() => orgIdOf(forged()[kind])).toThrow(OrgContextError)
    expect(() => orgIdOf(forged()[kind])).toThrow(expect.objectContaining({ name: 'OrgContextError' }))
  })

  it('orgIdOf returns the id of a minted context', () => {
    expect(orgIdOf(ctx)).toBe('o_1')
  })

  it('the test minter refuses to run in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(() => testOrgContext({ orgId: 'o_1' })).toThrow('Test-only function')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('the test minter refuses to run outside Vitest', () => {
    vi.stubEnv('VITEST', 'false')
    try {
      expect(() => testOrgContext({ orgId: 'o_1' })).toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
