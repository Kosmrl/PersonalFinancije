import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { CLUSTER_SUPERUSER } from '../../scripts/db/embedded.ts'
import {
  appPool,
  asTenant,
  createOrg,
  insertAudit,
  ownerPool,
  sqlState,
  type TestOrg,
} from '../helpers/db'

// Plan test item 9 (audit immutability) and the audit_log policies/trigger of the custom migration.

describe('audit_log is append-only', () => {
  const owner = ownerPool()
  const app = appPool()
  let org: TestOrg
  let auditId: number

  beforeAll(async () => {
    org = await createOrg(owner)
    auditId = await asTenant(app, org.id, (c) => insertAudit(c, org.id))
  })
  afterAll(async () => {
    await app.end()
    await owner.end()
  })

  it('pf_app can insert and read its own org rows', async () => {
    const { rows } = await asTenant(app, org.id, (c) =>
      c.query<{ id: string; changed_fields: string[]; occurred_at: Date }>(
        'select id, changed_fields, occurred_at from audit_log',
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.changed_fields).toEqual(['name'])
    expect(rows[0]?.occurred_at).toBeInstanceOf(Date)
  })

  it('UPDATE and DELETE as pf_app are refused (no grant)', async () => {
    expect(
      await sqlState(
        asTenant(app, org.id, (c) =>
          c.query(`update audit_log set action = 'x' where id = $1`, [auditId]),
        ),
      ),
    ).toBe('42501')
    expect(
      await sqlState(
        asTenant(app, org.id, (c) => c.query('delete from audit_log where id = $1', [auditId])),
      ),
    ).toBe('42501')
  })

  it('pf_app holds exactly SELECT and INSERT on audit_log', async () => {
    const { rows } = await owner.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'pf_app' and table_name = 'audit_log' order by privilege_type`,
    )
    expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT'])
  })

  it('the trigger raises on UPDATE and DELETE even where RLS would not stop the caller (superuser)', async () => {
    // A superuser bypasses RLS and every grant, so only the trigger is left to refuse.
    const admin = inject('clusterAdmin')
    const superuser = new pg.Client({
      host: '127.0.0.1',
      port: admin.port,
      user: CLUSTER_SUPERUSER,
      password: admin.superuserPassword,
      database: 'pf_test',
    })
    await superuser.connect()
    try {
      for (const statement of [
        `update audit_log set action = 'x' where id = ${auditId}`,
        `delete from audit_log where id = ${auditId}`,
      ]) {
        await expect(superuser.query(statement)).rejects.toMatchObject({
          code: '23001',
          message: expect.stringContaining('append-only'),
        })
      }
    } finally {
      await superuser.end()
    }
  })

  it('the row is unchanged afterwards', async () => {
    const { rows } = await asTenant(app, org.id, (c) =>
      c.query<{ action: string }>('select action from audit_log where id = $1', [auditId]),
    )
    expect(rows[0]?.action).toBe('customer.created')
  })

  it('has a BEFORE UPDATE OR DELETE row trigger and a BEFORE TRUNCATE statement trigger', async () => {
    const { rows } = await owner.query<{ def: string }>(
      `select pg_get_triggerdef(oid) as def from pg_trigger
        where tgrelid = 'audit_log'::regclass and not tgisinternal order by tgname`,
    )
    expect(rows).toHaveLength(2)
    const defs = rows.map((r) => r.def)
    expect(
      defs.some((d) =>
        /BEFORE (UPDATE OR DELETE|DELETE OR UPDATE) ON .*audit_log FOR EACH ROW/.test(d),
      ),
    ).toBe(true)
    expect(defs.some((d) => /BEFORE TRUNCATE ON .*audit_log FOR EACH STATEMENT/.test(d))).toBe(true)
  })

  it('TRUNCATE is refused for the owner and for a superuser (N1)', async () => {
    // pf_app has no TRUNCATE grant; the owner does hold it, so only the trigger stops it.
    await expect(owner.query('truncate audit_log')).rejects.toMatchObject({
      code: '23001',
      message: expect.stringContaining('append-only'),
    })
    const admin = inject('clusterAdmin')
    const superuser = new pg.Client({
      host: '127.0.0.1',
      port: admin.port,
      user: CLUSTER_SUPERUSER,
      password: admin.superuserPassword,
      database: 'pf_test',
    })
    await superuser.connect()
    try {
      await expect(superuser.query('truncate audit_log')).rejects.toMatchObject({ code: '23001' })
    } finally {
      await superuser.end()
    }
    const { rows } = await asTenant(app, org.id, (c) => c.query('select 1 from audit_log'))
    expect(rows.length).toBeGreaterThan(0)
  })

  it('the id is generated always: an explicit id is refused', async () => {
    expect(
      await sqlState(
        asTenant(app, org.id, (c) =>
          c.query(
            `insert into audit_log (id, organization_id, actor_user_id, action, entity_type, entity_id)
             values (999999999, $1, 'u', 'a', 'e', 'i')`,
            [org.id],
          ),
        ),
      ),
    ).toBe('428C9')
  })
})
