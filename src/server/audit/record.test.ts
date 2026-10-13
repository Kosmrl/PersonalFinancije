import { describe, expect, it, vi } from 'vitest'
import type { OrgContext } from '@/server/auth/context'
import type { Tx } from '@/server/db/tenant'
import { recordAudit } from './record'

// Made-up values only. The transaction is a stub that captures the inserted row.
const FAKE_OIB = '12345678903'
const FAKE_IBAN = 'HR1210010051863000160'

const ctx = { orgId: 'o_1', userId: 'u_1' } as OrgContext

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
      entityId: 'o_1',
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
      entityId: 'm_1',
      changedFields: ['role'],
    })
    await recordAudit(tx, ctx, {
      action: 'org.created',
      entityType: 'organization',
      entityId: 'o_1',
      changedFields: ['name', 'slug'],
    })
    expect(values).toHaveBeenCalledTimes(2)
  })

  it('defaults to no fields', async () => {
    const { tx, values } = stubTx()
    await recordAudit(tx, ctx, { action: 'item.archived', entityType: 'item', entityId: 'i_1' })
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
        entityId: 'c_1',
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
      entityId: 'c_1',
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
        entityId: 'x',
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
        entityId: 'c_1',
        // @ts-expect-error unitPrice is a column of items, not customers
        changedFields: ['unitPrice'],
      }))
    void (() =>
      recordAudit(tx, ctx, {
        // @ts-expect-error not one of the audited actions
        action: 'customer.exploded',
        entityType: 'customer',
        entityId: 'c_1',
      }))
    expect(true).toBe(true)
  })
})
