import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addMember, createOrg, createUser, ownerPool, sqlState } from '../helpers/db'

// Review item N6: uniqueness on the Better Auth tables (migration 0004_auth_uniqueness).

describe('auth table uniqueness (N6)', () => {
  const owner = ownerPool()
  afterAll(async () => {
    await owner.end()
  })
  beforeAll(async () => {
    await owner.query('select 1')
  })

  it('a user is a member of an organization at most once', async () => {
    const org = await createOrg(owner)
    const user = await createUser(owner)
    await addMember(owner, org.id, user.id, 'owner')
    expect(await sqlState(addMember(owner, org.id, user.id, 'member'))).toBe('23505')
  })

  it('the same user can join two organizations; two users can join one', async () => {
    const one = await createOrg(owner)
    const two = await createOrg(owner)
    const u1 = await createUser(owner)
    const u2 = await createUser(owner)
    await addMember(owner, one.id, u1.id)
    await addMember(owner, two.id, u1.id)
    await addMember(owner, one.id, u2.id)
  })

  it('a user has at most one two_factor row', async () => {
    const user = await createUser(owner)
    const insert = () =>
      owner.query(
        `insert into two_factor (id, secret, backup_codes, user_id) values ($1, 's', 'b', $2)`,
        [`tf_${randomBytes(6).toString('hex')}`, user.id],
      )
    await insert()
    expect(await sqlState(insert())).toBe('23505')
  })

  it('organization slug is unique, through exactly one unique index or constraint', async () => {
    const org = await createOrg(owner)
    expect(
      await sqlState(
        owner.query(
          `insert into organization (id, name, slug, created_at) values ($1, 'x', $2, now())`,
          [`o_${randomBytes(6).toString('hex')}`, org.slug],
        ),
      ),
    ).toBe('23505')
    const { rows } = await owner.query<{ indexname: string }>(
      `select i.indexname from pg_indexes i
        where i.tablename = 'organization' and i.indexdef like '%UNIQUE%(slug)%'`,
    )
    expect(rows).toHaveLength(1)
  })

  it('the redundant non-unique two_factor user_id index is gone', async () => {
    const { rows } = await owner.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'two_factor' and indexdef like '%(user_id)%'`,
    )
    expect(rows.map((r) => r.indexname)).toEqual(['two_factor_user_id_unique'])
  })
})
