import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRng, fakeOib, freshSeed } from '../helpers/fake'
import {
  appPool,
  asTenant,
  createOrg,
  insertCustomer,
  insertItem,
  insertProfile,
  ownerPool,
  sqlState,
  type TestOrg,
} from '../helpers/db'

// CHECK constraints and unique indexes of the tenant tables (plan: "Data model changes").

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

describe('tenant table constraints', () => {
  const owner = ownerPool()
  const app = appPool()
  const rng = createRng(freshSeed())
  let a: TestOrg
  let b: TestOrg

  beforeAll(async () => {
    a = await createOrg(owner)
    b = await createOrg(owner)
  })
  afterAll(async () => {
    await app.end()
    await owner.end()
  })

  describe('obrt_profiles', () => {
    it('refuses in_vat_system = true', async () => {
      const code = await sqlState(
        asTenant(app, a.id, async (c) => {
          await insertProfile(c, a.id, rng)
          await c.query('update obrt_profiles set in_vat_system = true')
        }),
      )
      expect(code).toBe(CHECK_VIOLATION)
    })

    it('has defaults country HR and not in VAT', async () => {
      const org = await createOrg(owner)
      const { rows } = await asTenant(app, org.id, async (c) => {
        await insertProfile(c, org.id, rng)
        return c.query<{ country_code: string; in_vat_system: boolean; oib: string }>(
          'select country_code, in_vat_system, oib from obrt_profiles',
        )
      })
      expect(rows[0]).toMatchObject({ country_code: 'HR', in_vat_system: false })
      expect(rows[0]?.oib).toHaveLength(11)
    })

    it('one obrt per OIB across organizations (unique), one profile per organization', async () => {
      const x = await createOrg(owner)
      const y = await createOrg(owner)
      const oib = await asTenant(app, x.id, (c) => insertProfile(c, x.id, rng))
      expect(await sqlState(asTenant(app, y.id, (c) => insertProfile(c, y.id, rng, { oib })))).toBe(
        UNIQUE_VIOLATION,
      )
      expect(await sqlState(asTenant(app, x.id, (c) => insertProfile(c, x.id, rng)))).toBe(
        UNIQUE_VIOLATION,
      )
    })

    it('requires an existing organization (foreign key)', async () => {
      expect(
        await sqlState(asTenant(app, 'o_missing', (c) => insertProfile(c, 'o_missing', rng))),
      ).toBe('23503')
    })
  })

  describe('format CHECKs (defence in depth)', () => {
    const profile = (c: pg.PoolClient, org: string, oib: string, country = 'HR') =>
      c.query(
        `insert into obrt_profiles
           (organization_id, trade_name, owner_full_name, oib, street, postal_code, city, iban,
            email, default_invoice_note, country_code)
         values ($1, 'Test Obrt', 'Test Vlasnik', $2, 'Testna ulica 1', '10000', 'Zagreb',
                 'HR1210010051863000160', 'obrt@example.test', 'Test note', $3)`,
        [org, oib, country],
      )

    it('obrt_profiles.oib must be exactly 11 digits', async () => {
      for (const oib of ['1234567890 ', '1234567890a', '12345 67890', 'abcdefghijk']) {
        const org = await createOrg(owner)
        expect(await sqlState(asTenant(app, org.id, (c) => profile(c, org.id, oib))), oib).toBe(
          CHECK_VIOLATION,
        )
      }
    })

    it('obrt_profiles.country_code must be two capital letters', async () => {
      for (const country of ['hr', 'H1', '1R']) {
        const org = await createOrg(owner)
        expect(
          await sqlState(asTenant(app, org.id, (c) => profile(c, org.id, fakeOib(rng), country))),
          country,
        ).toBe(CHECK_VIOLATION)
      }
    })

    it('customers.oib must be 11 digits when set; NULL is fine', async () => {
      for (const oib of ['1234567890', '1234567890a', 'abcdefghijk']) {
        expect(
          await sqlState(
            asTenant(app, a.id, (c) => insertCustomer(c, a.id, { kind: 'person', oib })),
          ),
          oib,
        ).toBe(CHECK_VIOLATION)
      }
      await asTenant(app, a.id, (c) => insertCustomer(c, a.id, { kind: 'person', oib: null }))
    })

    it('customers.country_code must be two capital letters', async () => {
      for (const countryCode of ['hr', 'H1']) {
        expect(
          await sqlState(asTenant(app, a.id, (c) => insertCustomer(c, a.id, { countryCode }))),
          countryCode,
        ).toBe(CHECK_VIOLATION)
      }
    })

    it('items.currency must be three capital letters', async () => {
      for (const currency of ['eur', 'EU1', 'E R']) {
        expect(
          await sqlState(
            asTenant(app, a.id, (c) =>
              c.query(
                `insert into items (organization_id, name, unit_code, unit_price, currency)
                 values ($1, 'x', 'H87', '1', $2)`,
                [a.id, currency],
              ),
            ),
          ),
          currency,
        ).toBe(CHECK_VIOLATION)
      }
    })

    it('items.kpd_code must be six digits when set; NULL is fine', async () => {
      const insert = (c: pg.PoolClient, kpd: string | null) =>
        c.query(
          `insert into items (organization_id, name, unit_code, unit_price, kpd_code)
           values ($1, 'x', 'H87', '1', $2)`,
          [a.id, kpd],
        )
      for (const kpd of ['62011', 'a20111', '62.011']) {
        expect(await sqlState(asTenant(app, a.id, (c) => insert(c, kpd))), kpd).toBe(
          CHECK_VIOLATION,
        )
      }
      await asTenant(app, a.id, async (c) => {
        await insert(c, '620111')
        await insert(c, null)
      })
    })
  })

  describe('customers', () => {
    it('kind must be person or business', async () => {
      expect(
        await sqlState(asTenant(app, a.id, (c) => insertCustomer(c, a.id, { kind: 'company' }))),
      ).toBe(CHECK_VIOLATION)
    })

    it('an HR business needs an OIB; a person, or a foreign business, does not', async () => {
      expect(
        await sqlState(asTenant(app, a.id, (c) => insertCustomer(c, a.id, { kind: 'business' }))),
      ).toBe(CHECK_VIOLATION)
      await asTenant(app, a.id, async (c) => {
        await insertCustomer(c, a.id, { kind: 'person' })
        await insertCustomer(c, a.id, { kind: 'business', countryCode: 'DE' })
        await insertCustomer(c, a.id, { kind: 'business', oib: fakeOib(rng) })
      })
    })

    it('OIB is unique among active customers of one organization', async () => {
      const org = await createOrg(owner)
      const oib = fakeOib(rng)
      await asTenant(app, org.id, (c) => insertCustomer(c, org.id, { kind: 'business', oib }))
      expect(
        await sqlState(
          asTenant(app, org.id, (c) => insertCustomer(c, org.id, { kind: 'business', oib })),
        ),
      ).toBe(UNIQUE_VIOLATION)
    })

    it('the same OIB is fine in another organization', async () => {
      const x = await createOrg(owner)
      const y = await createOrg(owner)
      const oib = fakeOib(rng)
      await asTenant(app, x.id, (c) => insertCustomer(c, x.id, { kind: 'business', oib }))
      await asTenant(app, y.id, (c) => insertCustomer(c, y.id, { kind: 'business', oib }))
    })

    it('an archived customer frees its OIB; restoring into a clash is refused', async () => {
      const org = await createOrg(owner)
      const oib = fakeOib(rng)
      const first = await asTenant(app, org.id, (c) =>
        insertCustomer(c, org.id, { kind: 'business', oib }),
      )
      await asTenant(app, org.id, (c) =>
        c.query('update customers set archived_at = now() where id = $1', [first]),
      )
      await asTenant(app, org.id, (c) => insertCustomer(c, org.id, { kind: 'business', oib }))
      expect(
        await sqlState(
          asTenant(app, org.id, (c) =>
            c.query('update customers set archived_at = null where id = $1', [first]),
          ),
        ),
      ).toBe(UNIQUE_VIOLATION)
    })

    it('customers without OIB do not collide with each other', async () => {
      const org = await createOrg(owner)
      await asTenant(app, org.id, async (c) => {
        await insertCustomer(c, org.id, { kind: 'person', name: 'Isti' })
        await insertCustomer(c, org.id, { kind: 'person', name: 'Isti' })
      })
    })

    it('has UNIQUE (organization_id, id) for composite foreign keys, and the lower(name) index', async () => {
      const { rows } = await owner.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'customers'::regclass and contype = 'u'`,
      )
      expect(rows.map((r) => r.def)).toContain('UNIQUE (organization_id, id)')
      const idx = await owner.query<{ def: string }>(
        `select indexdef as def from pg_indexes where tablename = 'customers'`,
      )
      expect(idx.rows.some((r) => /lower\(name\)/.test(r.def))).toBe(true)
    })
  })

  describe('items', () => {
    it('unit_price must not be negative; zero is fine', async () => {
      expect(
        await sqlState(asTenant(app, a.id, (c) => insertItem(c, a.id, { unitPrice: '-0.01' }))),
      ).toBe(CHECK_VIOLATION)
      await asTenant(app, a.id, (c) => insertItem(c, a.id, { unitPrice: '0' }))
    })

    it('unit_price is an exact numeric(19,6): 0.125 round-trips as the string 0.125000', async () => {
      const org = await createOrg(owner)
      const { rows } = await asTenant(app, org.id, async (c) => {
        await insertItem(c, org.id, { unitPrice: '0.125' })
        return c.query<{ unit_price: string; currency: string }>(
          'select unit_price, currency from items',
        )
      })
      // pg returns numeric as a string, never a JS number.
      expect(rows[0]).toEqual({ unit_price: '0.125000', currency: 'EUR' })
    })

    it('unit_price rounds nothing silently beyond its scale limit of 6 decimals (stored rounded by numeric)', async () => {
      // The 6-decimal limit is validated by the action; numeric(19,6) rounds the 7th decimal.
      const org = await createOrg(owner)
      const { rows } = await asTenant(app, org.id, async (c) => {
        await insertItem(c, org.id, { unitPrice: '0.1234564' })
        return c.query<{ unit_price: string }>('select unit_price from items')
      })
      expect(rows[0]?.unit_price).toBe('0.123456')
    })

    it('has UNIQUE (organization_id, id)', async () => {
      const { rows } = await owner.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'items'::regclass and contype = 'u'`,
      )
      expect(rows.map((r) => r.def)).toContain('UNIQUE (organization_id, id)')
    })
  })

  it('timestamps are timestamptz and the OIB and country columns are fixed-width chars', async () => {
    const { rows } = await owner.query<{
      table_name: string
      column_name: string
      data_type: string
    }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_name in ('obrt_profiles','customers','items','audit_log')
          and (data_type like 'timestamp%' or column_name in ('oib','country_code','currency','kpd_code'))`,
    )
    for (const row of rows) {
      const expected = /_at$/.test(row.column_name) ? 'timestamp with time zone' : 'character'
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe(expected)
    }
    expect(rows.length).toBeGreaterThan(10)
  })

  // Keeps `b` meaningful: a constraint on one org never affects another.
  it('an unrelated organization is unaffected by constraint failures elsewhere', async () => {
    await asTenant(app, b.id, (c) => insertItem(c, b.id))
  })
})
