import { randomBytes } from 'node:crypto'
import type { AsyncLocalStorage } from 'node:async_hooks'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { createRng, fakeHrIban, fakeIban, fakeOib, freshSeed } from '../helpers/fake'
import { appPool, asTenant, ownerPool } from '../helpers/db'

// The organization actions against the real database AND the real Better Auth instance (sessions,
// organization plugin, invitations). Only Next's request APIs and the mail transport are mocked.
// The signed-in user of a call is chosen with as(user, fn): the headers mock reads an
// AsyncLocalStorage, so two users can act concurrently.

const mocks = vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule('node:async_hooks')
  return {
    store: new AsyncLocalStorage<Headers>() as AsyncLocalStorage<Headers>,
    // When on, the OIB pre-check answers "free", so the unique constraint is what decides.
    skipOibCheck: { on: false },
    // When on, writing the member.joined audit row throws.
    failJoinedAudit: { on: false },
    // When on, the cheap up-front sole-member check answers "yes", so only the check under the
    // organization lock (at the profile insert) can refuse.
    forceSole: { on: false },
  }
})

vi.mock('next/headers', () => ({
  headers: async () => mocks.store.getStore() ?? new Headers(),
  cookies: async () => ({ set() {}, get() {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
  // The real one rethrows Next's control-flow errors and returns for everything else.
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && /^NEXT_(NOT_FOUND|REDIRECT)/.test(error.message)) throw error
  },
}))
vi.mock('@/server/org/queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/org/queries')>()
  return {
    ...original,
    isOibRegistered: (oib: string) =>
      mocks.skipOibCheck.on ? Promise.resolve(false) : original.isOibRegistered(oib),
    isSoleMember: (...args: Parameters<typeof original.isSoleMember>) =>
      mocks.forceSole.on ? Promise.resolve(true) : original.isSoleMember(...args),
  }
})
vi.mock('@/server/audit/record', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/audit/record')>()
  return {
    ...original,
    recordAudit: (...args: Parameters<typeof original.recordAudit>) => {
      if (mocks.failJoinedAudit.on && args[2].action === 'member.joined') {
        return Promise.reject(new Error('audit write failed'))
      }
      return original.recordAudit(...args)
    },
  }
})
vi.mock('@/server/email/transport', () => ({ sendMail: vi.fn(async () => {}) }))

const PASSWORD = 'test-password-123'
const BASE_URL = 'http://localhost:3000'

type TestUser = { id: string; email: string; headers: Headers }

describe('organization actions', () => {
  const owner = ownerPool()
  const app = appPool()
  const rng = createRng(freshSeed())
  // A distinct client address per user, so the per-client rate limit never couples tests.
  let nextIp = Math.floor(Math.random() * 60000)
  const newClientIp = () => `10.${(nextIp >> 8) & 255}.${nextIp++ & 255}.7`

  let actions: typeof import('@/server/org/actions')
  let authModule: typeof import('@/server/auth/auth')
  let client: typeof import('@/server/db/client')
  let transport: typeof import('@/server/email/transport')
  let messages: typeof import('@/server/org/messages')
  let schemas: typeof import('@/server/org/schemas')
  let hashPassword: (password: string) => Promise<string>

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    process.env.BETTER_AUTH_SECRET = randomBytes(24).toString('hex')
    process.env.BETTER_AUTH_URL = BASE_URL
    process.env.SMTP_HOST = 'localhost'
    process.env.MAIL_FROM = 'test@example.test'
    actions = await import('@/server/org/actions')
    authModule = await import('@/server/auth/auth')
    client = await import('@/server/db/client')
    transport = await import('@/server/email/transport')
    messages = await import('@/server/org/messages')
    schemas = await import('@/server/org/schemas')
    ;({ hashPassword } = await import('better-auth/crypto'))
  })
  afterAll(async () => {
    await client.getPool().end()
    await app.end()
    await owner.end()
  })

  // --- helpers ---------------------------------------------------------------------------------

  /** A verified user with a password, signed in through Better Auth (real session cookie). */
  async function makeUser(
    options: { email?: string; verified?: boolean; storedEmail?: string } = {},
  ): Promise<TestUser> {
    const id = `u${randomBytes(15).toString('hex')}`
    const email = options.email ?? `${id}@example.test`
    await owner.query(
      `insert into "user" (id, name, email, email_verified) values ($1, 'Test User', $2, $3)`,
      [id, email, options.verified ?? true],
    )
    await owner.query(
      `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $3, $4, now(), now())`,
      [`a${randomBytes(15).toString('hex')}`, id, id, await hashPassword(PASSWORD)],
    )
    // Unverified users cannot sign in through Better Auth; give them a session directly.
    const headers = new Headers({ 'x-forwarded-for': newClientIp() })
    if (options.verified ?? true) {
      const signedIn = await authModule.getAuth().api.signInEmail({
        body: { email, password: PASSWORD },
        returnHeaders: true,
      })
      const cookie = signedIn.headers
        .getSetCookie()
        .map((line) => line.split(';')[0])
        .join('; ')
      headers.set('cookie', cookie)
    } else {
      const token = randomBytes(16).toString('hex')
      await owner.query(
        `insert into session (id, expires_at, token, created_at, updated_at, user_id)
         values ($1, now() + interval '1 day', $2, now(), now(), $3)`,
        [`s${randomBytes(15).toString('hex')}`, token, id],
      )
      // Not a signed cookie: this user is only used where the session is refused anyway.
      headers.set('cookie', `better-auth.session_token=${token}`)
    }
    // Better Auth looks addresses up in lower case, so a mixed-case stored address is set after
    // the sign-in (the session is bound to the user id).
    if (options.storedEmail) {
      await owner.query('update "user" set email = $1 where id = $2', [options.storedEmail, id])
    }
    return { id, email: options.storedEmail ?? email, headers }
  }

  function as<T>(user: TestUser, fn: () => Promise<T>): Promise<T> {
    return mocks.store.run(user.headers, fn)
  }

  function profileInput(overrides: Record<string, unknown> = {}) {
    return {
      tradeName: `Obrt ${randomBytes(3).toString('hex')}`,
      ownerFullName: 'Test Vlasnik',
      oib: fakeOib(rng),
      street: 'Testna ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
      countryCode: 'HR',
      iban: fakeHrIban(rng),
      email: 'obrt@example.test',
      phone: '',
      website: '',
      defaultInvoiceNote: 'Test napomena',
      declareNotInVat: true,
      ...overrides,
    }
  }

  async function onboard(user: TestUser, overrides: Record<string, unknown> = {}) {
    const input = profileInput(overrides)
    const result = await as(user, () => actions.createOrganizationWithProfile(input))
    if (!result.ok) throw new Error(`onboarding failed: ${result.message}`)
    const { rows } = await owner.query<{ id: string }>(
      'select id from organization where slug = $1',
      [result.data.orgSlug],
    )
    return { slug: result.data.orgSlug, orgId: rows[0]!.id, oib: input.oib as string }
  }

  async function memberIdOf(orgId: string, userId: string): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      'select id from member where organization_id = $1 and user_id = $2',
      [orgId, userId],
    )
    return rows[0]!.id
  }

  async function roleOf(orgId: string, userId: string): Promise<string | undefined> {
    const { rows } = await owner.query<{ role: string }>(
      'select role from member where organization_id = $1 and user_id = $2',
      [orgId, userId],
    )
    return rows[0]?.role
  }

  async function auditRows(orgId: string) {
    return asTenant(app, orgId, async (c) => {
      const { rows } = await c.query<{
        action: string
        entity_type: string
        entity_id: string
        changed_fields: string[]
        actor_user_id: string
      }>(
        `select action, entity_type, entity_id, changed_fields, actor_user_id
           from audit_log where organization_id = $1 order by id`,
        [orgId],
      )
      return rows
    })
  }

  /** Invites `invited` as `role` and accepts it, so the user is a member. */
  async function addViaInvitation(
    inviter: TestUser,
    slug: string,
    invited: TestUser,
    role: 'accountant' | 'member',
  ) {
    const invite = await as(inviter, () =>
      actions.inviteMember({ orgSlug: slug, email: invited.email, role }),
    )
    if (!invite.ok) throw new Error(`invite failed: ${invite.message}`)
    const accepted = await as(invited, () =>
      actions.acceptInvitation({ invitationId: invite.data.invitationId }),
    )
    if (!accepted.ok) throw new Error(`accept failed: ${accepted.message}`)
    return invite.data.invitationId
  }

  const FORBIDDEN = 'Nemate ovlasti za ovu radnju.'

  // --- plan item 12: onboarding ----------------------------------------------------------------

  describe('onboarding (createOrganizationWithProfile)', () => {
    it('creates the organization through Better Auth, the profile and one org.created audit row', async () => {
      const user = await makeUser()
      const input = profileInput({ tradeName: 'Čačkalica & Đurđevak d.o.o.' })
      const result = await as(user, () => actions.createOrganizationWithProfile(input))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.orgSlug).toBe('cackalica-durdevak-d-o-o')
      expect(result.data.nonHrIban).toBe(false)

      const { rows: org } = await owner.query<{ id: string; name: string }>(
        'select id, name from organization where slug = $1',
        [result.data.orgSlug],
      )
      expect(org[0]?.name).toBe(input.tradeName)
      const orgId = org[0]!.id
      expect(await roleOf(orgId, user.id)).toBe('owner')

      const profile = await asTenant(app, orgId, (c) =>
        c.query<{ oib: string; in_vat_system: boolean; iban: string; country_code: string }>(
          'select oib, in_vat_system, iban, country_code from obrt_profiles',
        ),
      )
      expect(profile.rows).toHaveLength(1)
      expect(profile.rows[0]).toMatchObject({
        oib: input.oib,
        in_vat_system: false,
        iban: input.iban,
        country_code: 'HR',
      })

      const audit = await auditRows(orgId)
      expect(audit).toEqual([
        {
          action: 'org.created',
          entity_type: 'organization',
          entity_id: orgId,
          changed_fields: ['name', 'slug'],
          actor_user_id: user.id,
        },
      ])
    })

    it('normalizes the IBAN (spaces, lower case) and the OIB (spaces)', async () => {
      const user = await makeUser()
      const oib = fakeOib(rng)
      const iban = fakeHrIban(rng)
      const spaced = iban.replace(/(.{4})/g, '$1 ').toLowerCase()
      const { orgId } = await onboard(user, {
        oib: `${oib.slice(0, 5)} ${oib.slice(5)}`,
        iban: spaced,
      })
      const { rows } = await asTenant(app, orgId, (c) =>
        c.query<{ oib: string; iban: string }>('select oib, iban from obrt_profiles'),
      )
      expect(rows[0]).toEqual({ oib, iban })
    })

    it('avoids a taken slug and a reserved slug', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const first = await onboard(a, { tradeName: 'Isti Naziv' })
      const second = await onboard(b, { tradeName: 'Isti Naziv' })
      expect(first.slug).toBe('isti-naziv')
      expect(second.slug).toMatch(/^isti-naziv-[a-z0-9]{4}$/)
      const reserved = await onboard(await makeUser(), { tradeName: 'Novi obrt' })
      expect(reserved.slug).toMatch(/^novi-obrt-[a-z0-9]{4}$/)
    })

    it('answers a duplicate OIB with the friendly message and leaks nothing about the holder', async () => {
      const holder = await makeUser()
      const { oib, slug, orgId } = await onboard(holder, { tradeName: 'Tajni Obrt Holder' })
      const other = await makeUser()
      const result = await as(other, () =>
        actions.createOrganizationWithProfile(profileInput({ oib })),
      )
      expect(result).toEqual({
        ok: false,
        message: 'Obrt s tim OIB-om već je registriran. Zatražite pozivnicu od vlasnika.',
        fieldErrors: {
          oib: 'Obrt s tim OIB-om već je registriran. Zatražite pozivnicu od vlasnika.',
        },
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(slug)
      expect(serialized).not.toContain(orgId)
      expect(serialized).not.toContain('Tajni')
      // And no organization was created for the second user.
      const { rowCount } = await owner.query('select 1 from member where user_id = $1', [other.id])
      expect(rowCount).toBe(0)
    })

    it('maps the unique-violation of a lost OIB race to the same message (pre-check stubbed)', async () => {
      const holder = await makeUser()
      const { oib, orgId: holderOrgId } = await onboard(holder)
      const racer = await makeUser()
      mocks.skipOibCheck.on = true
      try {
        const result = await as(racer, () =>
          actions.createOrganizationWithProfile(profileInput({ oib })),
        )
        // The pre-check said "free"; only the unique constraint (23505) can have refused it.
        expect(result).toEqual({
          ok: false,
          message: schemas.OIB_TAKEN_MESSAGE,
          fieldErrors: { oib: schemas.OIB_TAKEN_MESSAGE },
        })
      } finally {
        mocks.skipOibCheck.on = false
      }
      // Profiles are under row-level security (even for the owner role): look through the tenant.
      const held = await asTenant(app, holderOrgId, (c) =>
        c.query<{ n: string }>('select count(*) as n from obrt_profiles where oib = $1', [oib]),
      )
      expect(Number(held.rows[0]!.n)).toBe(1)
    })

    it('rejects an organization that is not declared outside the VAT system, and ignores in_vat_system', async () => {
      const user = await makeUser()
      const notDeclared = await as(user, () =>
        actions.createOrganizationWithProfile(profileInput({ declareNotInVat: false })),
      )
      expect(notDeclared.ok).toBe(false)
      if (!notDeclared.ok) {
        expect(notDeclared.fieldErrors?.declareNotInVat).toBe(
          'Aplikacija je trenutno namijenjena paušalistima izvan sustava PDV-a.',
        )
      }
      const missing = await as(user, () =>
        actions.createOrganizationWithProfile({ ...profileInput(), declareNotInVat: undefined }),
      )
      expect(missing.ok).toBe(false)
      expect(
        (await owner.query('select 1 from member where user_id = $1', [user.id])).rowCount,
      ).toBe(0)

      const smuggled = await as(user, () =>
        actions.createOrganizationWithProfile(
          profileInput({ inVatSystem: true, in_vat_system: true }),
        ),
      )
      expect(smuggled.ok).toBe(true)
      if (!smuggled.ok) return
      const { rows: org } = await owner.query<{ id: string }>(
        'select id from organization where slug = $1',
        [smuggled.data.orgSlug],
      )
      const profile = await asTenant(app, org[0]!.id, (c) =>
        c.query<{ in_vat_system: boolean }>('select in_vat_system from obrt_profiles'),
      )
      expect(profile.rows[0]?.in_vat_system).toBe(false)
    })

    it('returns field errors for invalid fields', async () => {
      const user = await makeUser()
      const result = await as(user, () =>
        actions.createOrganizationWithProfile(
          profileInput({
            tradeName: '   ',
            oib: '12345678900',
            postalCode: '1000',
            iban: 'HR0000000000000000000',
            email: 'nije-mail',
            countryCode: 'DE',
            website: 'ftp://x',
          }),
        ),
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(
        ['countryCode', 'email', 'iban', 'oib', 'postalCode', 'tradeName', 'website'].sort(),
      )
      expect(result.fieldErrors?.oib).toBe('Neispravan OIB.')
      expect(result.fieldErrors?.postalCode).toBe('Poštanski broj mora imati 5 znamenki.')
    })

    it('accepts a valid non-HR IBAN with a warning flag', async () => {
      const user = await makeUser()
      const result = await as(user, () =>
        actions.createOrganizationWithProfile(profileInput({ iban: fakeIban(rng, 'DE') })),
      )
      expect(result.ok && result.data.nonHrIban).toBe(true)
    })

    it('rate limits the OIB check per user and logs no OIB', async () => {
      const holder = await makeUser()
      const { oib } = await onboard(holder)
      const user = await makeUser()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const outcomes: string[] = []
        for (let i = 0; i < 12; i++) {
          const result = await as(user, () =>
            actions.createOrganizationWithProfile(profileInput({ oib })),
          )
          outcomes.push(result.ok ? 'ok' : result.message)
        }
        expect(outcomes.slice(0, 10).every((m) => m === schemas.OIB_TAKEN_MESSAGE)).toBe(true)
        expect(outcomes[10]).toBe('Previše pokušaja. Pokušajte ponovno za nekoliko minuta.')
        expect(outcomes[11]).toBe('Previše pokušaja. Pokušajte ponovno za nekoliko minuta.')
        const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join('\n')
        expect(logged).toContain('oib registration check')
        expect(logged).not.toContain(oib)
      } finally {
        logSpy.mockRestore()
        warnSpy.mockRestore()
      }
    })

    it('finishes onboarding of an organization without a profile (no second organization)', async () => {
      const user = await makeUser()
      const created = await authModule.getAuth().api.createOrganization({
        body: { name: 'Napola', slug: `napola-${randomBytes(3).toString('hex')}`, userId: user.id },
      })
      const input = profileInput({ existingOrgSlug: created.slug })
      const result = await as(user, () => actions.createOrganizationWithProfile(input))
      expect(result.ok && result.data.orgSlug).toBe(created.slug)
      const { rowCount } = await owner.query('select 1 from member where user_id = $1', [user.id])
      expect(rowCount).toBe(1)
      // N4: the organization name follows the trade name entered at the end of onboarding.
      const named = await owner.query<{ name: string }>(
        'select name from organization where slug = $1',
        [created.slug],
      )
      expect(named.rows[0]?.name).toBe(input.tradeName)
      const again = await as(user, () =>
        actions.createOrganizationWithProfile(profileInput({ existingOrgSlug: created.slug })),
      )
      expect(again).toMatchObject({ ok: false, message: 'Podaci o obrtu već su uneseni.' })
    })

    it("a non-owner cannot finish somebody else's organization", async () => {
      const ownerUser = await makeUser()
      const stranger = await makeUser()
      const created = await authModule.getAuth().api.createOrganization({
        body: {
          name: 'Tuđe',
          slug: `tude-${randomBytes(3).toString('hex')}`,
          userId: ownerUser.id,
        },
      })
      await expect(
        as(stranger, () =>
          actions.createOrganizationWithProfile(profileInput({ existingOrgSlug: created.slug })),
        ),
      ).rejects.toThrow('NEXT_NOT_FOUND')
    })

    it('the org layout sends an owner without a profile back to onboarding', async () => {
      const user = await makeUser()
      const created = await authModule.getAuth().api.createOrganization({
        body: {
          name: 'Bez profila',
          slug: `bez-profila-${randomBytes(3).toString('hex')}`,
          userId: user.id,
        },
      })
      const { default: OrgLayout } = await import('@/app/app/[org]/layout')
      await expect(
        as(user, () =>
          OrgLayout({ children: null, params: Promise.resolve({ org: created.slug }) }),
        ),
      ).rejects.toThrow(`NEXT_REDIRECT:/app/novi-obrt?org=${created.slug}`)
    })
  })

  // --- plan item 7: action-level tenancy -------------------------------------------------------

  describe('tenancy of the actions', () => {
    it("a member of A calling with B's slug gets notFound and nothing changes", async () => {
      const ownerA = await makeUser()
      const ownerB = await makeUser()
      const a = await onboard(ownerA)
      const b = await onboard(ownerB)
      const bMember = await makeUser()
      await addViaInvitation(ownerB, b.slug, bMember, 'member')
      const bMemberId = await memberIdOf(b.orgId, bMember.id)
      const pendingInvite = await as(ownerB, () =>
        actions.inviteMember({ orgSlug: b.slug, email: 'pending@example.test', role: 'member' }),
      )
      expect(pendingInvite.ok).toBe(true)
      const invitationId = pendingInvite.ok ? pendingInvite.data.invitationId : ''
      const auditBefore = (await auditRows(b.orgId)).length

      // ownerA is the owner of A and not a member of B at all.
      const attempts: [string, () => Promise<unknown>][] = [
        [
          'updateObrtProfile',
          () => actions.updateObrtProfile({ ...profileInput(), orgSlug: b.slug }),
        ],
        [
          'inviteMember',
          () => actions.inviteMember({ orgSlug: b.slug, email: 'x@example.test', role: 'member' }),
        ],
        ['revokeInvitation', () => actions.revokeInvitation({ orgSlug: b.slug, invitationId })],
        [
          'changeMemberRole',
          () => actions.changeMemberRole({ orgSlug: b.slug, memberId: bMemberId, role: 'owner' }),
        ],
        ['removeMember', () => actions.removeMember({ orgSlug: b.slug, memberId: bMemberId })],
      ]
      for (const [name, attempt] of attempts) {
        await expect(as(ownerA, attempt), name).rejects.toThrow('NEXT_NOT_FOUND')
      }
      // A slug that does not exist looks the same.
      await expect(
        as(ownerA, () =>
          actions.inviteMember({ orgSlug: 'nema-takvog', email: 'x@example.test', role: 'member' }),
        ),
      ).rejects.toThrow('NEXT_NOT_FOUND')

      expect(await roleOf(b.orgId, bMember.id)).toBe('member')
      expect((await auditRows(b.orgId)).length).toBe(auditBefore)
      const { rows } = await owner.query('select 1 from invitation where id = $1 and status = $2', [
        invitationId,
        'pending',
      ])
      expect(rows).toHaveLength(1)
      // Org A is untouched as well.
      expect((await auditRows(a.orgId)).map((r) => r.action)).toEqual(['org.created'])
    })

    it('a member whose membership row was removed is refused immediately', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const accountant = await makeUser()
      await addViaInvitation(ownerUser, slug, accountant, 'accountant')
      await owner.query('delete from member where organization_id = $1 and user_id = $2', [
        orgId,
        accountant.id,
      ])
      await expect(
        as(accountant, () =>
          actions.inviteMember({ orgSlug: slug, email: 'x@example.test', role: 'member' }),
        ),
      ).rejects.toThrow('NEXT_NOT_FOUND')
    })
  })

  // --- plan item 8: role matrix, last owner ----------------------------------------------------

  describe('role matrix', () => {
    it('only the owner may edit the profile and manage members', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const accountant = await makeUser()
      const member = await makeUser()
      await addViaInvitation(ownerUser, slug, accountant, 'accountant')
      await addViaInvitation(ownerUser, slug, member, 'member')
      const memberId = await memberIdOf(orgId, member.id)
      const pending = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: 'wait@example.test', role: 'member' }),
      )
      const invitationId = pending.ok ? pending.data.invitationId : ''
      const auditBefore = (await auditRows(orgId)).length

      for (const user of [accountant, member]) {
        const results = await Promise.all([
          as(user, () => actions.updateObrtProfile({ ...profileInput(), orgSlug: slug })),
          as(user, () =>
            actions.inviteMember({ orgSlug: slug, email: 'y@example.test', role: 'member' }),
          ),
          as(user, () => actions.revokeInvitation({ orgSlug: slug, invitationId })),
          as(user, () => actions.changeMemberRole({ orgSlug: slug, memberId, role: 'owner' })),
          as(user, () => actions.removeMember({ orgSlug: slug, memberId })),
        ])
        for (const result of results) expect(result).toEqual({ ok: false, message: FORBIDDEN })
      }
      expect(await roleOf(orgId, member.id)).toBe('member')
      expect((await auditRows(orgId)).length).toBe(auditBefore)

      // The owner can.
      const update = await as(ownerUser, () =>
        actions.updateObrtProfile({ ...profileInput(), orgSlug: slug, tradeName: 'Novo ime' }),
      )
      expect(update.ok).toBe(true)
      expect(
        (
          await as(ownerUser, () =>
            actions.changeMemberRole({ orgSlug: slug, memberId, role: 'accountant' }),
          )
        ).ok,
      ).toBe(true)
      expect(await roleOf(orgId, member.id)).toBe('accountant')
      expect(
        (await as(ownerUser, () => actions.revokeInvitation({ orgSlug: slug, invitationId }))).ok,
      ).toBe(true)
      expect(
        (await as(ownerUser, () => actions.removeMember({ orgSlug: slug, memberId }))).ok,
      ).toBe(true)
      expect(await roleOf(orgId, member.id)).toBeUndefined()
    })

    it('the last owner cannot be demoted or removed', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const ownerMemberId = await memberIdOf(orgId, ownerUser.id)
      const auditBefore = (await auditRows(orgId)).length

      const demote = await as(ownerUser, () =>
        actions.changeMemberRole({ orgSlug: slug, memberId: ownerMemberId, role: 'member' }),
      )
      expect(demote).toEqual({ ok: false, message: messages.LAST_OWNER_MESSAGE })
      const remove = await as(ownerUser, () =>
        actions.removeMember({ orgSlug: slug, memberId: ownerMemberId }),
      )
      expect(remove).toEqual({ ok: false, message: messages.LAST_OWNER_MESSAGE })
      expect(await roleOf(orgId, ownerUser.id)).toBe('owner')
      expect((await auditRows(orgId)).length).toBe(auditBefore)

      // With a second owner, the first can step down.
      const second = await makeUser()
      await addViaInvitation(ownerUser, slug, second, 'member')
      const secondId = await memberIdOf(orgId, second.id)
      expect(
        (
          await as(ownerUser, () =>
            actions.changeMemberRole({ orgSlug: slug, memberId: secondId, role: 'owner' }),
          )
        ).ok,
      ).toBe(true)
      expect(
        (
          await as(ownerUser, () =>
            actions.changeMemberRole({ orgSlug: slug, memberId: ownerMemberId, role: 'member' }),
          )
        ).ok,
      ).toBe(true)
      expect(await roleOf(orgId, ownerUser.id)).toBe('member')
      // Now `second` is the last owner.
      expect(
        await as(second, () => actions.removeMember({ orgSlug: slug, memberId: secondId })),
      ).toEqual({
        ok: false,
        message: messages.LAST_OWNER_MESSAGE,
      })
    })

    it('concurrent demotions of the two owners leave exactly one owner', async () => {
      for (let round = 0; round < 3; round++) {
        const a = await makeUser()
        const { slug, orgId } = await onboard(a)
        const b = await makeUser()
        await addViaInvitation(a, slug, b, 'member')
        const aId = await memberIdOf(orgId, a.id)
        const bId = await memberIdOf(orgId, b.id)
        expect(
          (
            await as(a, () =>
              actions.changeMemberRole({ orgSlug: slug, memberId: bId, role: 'owner' }),
            )
          ).ok,
        ).toBe(true)

        const results = await Promise.all([
          as(a, () => actions.changeMemberRole({ orgSlug: slug, memberId: bId, role: 'member' })),
          as(b, () => actions.changeMemberRole({ orgSlug: slug, memberId: aId, role: 'member' })),
        ])
        expect(results.filter((r) => r.ok)).toHaveLength(1)
        const { rows } = await owner.query<{ n: string }>(
          `select count(*) as n from member where organization_id = $1 and role = 'owner'`,
          [orgId],
        )
        expect(rows[0]!.n).toBe('1')
      }
    })

    it('concurrent removals of the two owners leave exactly one owner', async () => {
      for (let round = 0; round < 3; round++) {
        const a = await makeUser()
        const { slug, orgId } = await onboard(a)
        const b = await makeUser()
        await addViaInvitation(a, slug, b, 'member')
        const aId = await memberIdOf(orgId, a.id)
        const bId = await memberIdOf(orgId, b.id)
        expect(
          (
            await as(a, () =>
              actions.changeMemberRole({ orgSlug: slug, memberId: bId, role: 'owner' }),
            )
          ).ok,
        ).toBe(true)

        const results = await Promise.all([
          as(a, () => actions.removeMember({ orgSlug: slug, memberId: bId })),
          as(b, () => actions.removeMember({ orgSlug: slug, memberId: aId })),
        ])
        expect(results.filter((r) => r.ok)).toHaveLength(1)
        const { rows } = await owner.query<{ n: string }>(
          `select count(*) as n from member where organization_id = $1`,
          [orgId],
        )
        expect(rows[0]!.n).toBe('1')
      }
    })

    it('does not accept an unknown role or the owner role in an invitation', async () => {
      const ownerUser = await makeUser()
      const { slug } = await onboard(ownerUser)
      for (const role of ['owner', 'admin', '', 'accountant,owner']) {
        const result = await as(ownerUser, () =>
          actions.inviteMember({ orgSlug: slug, email: 'z@example.test', role }),
        )
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.fieldErrors?.role).toBeTruthy()
      }
    })
  })

  // --- plan item 9: audit rows -----------------------------------------------------------------

  describe('audit rows', () => {
    it('writes exactly one row per mutating action, with field names only', async () => {
      const ownerUser = await makeUser()
      const iban = fakeHrIban(rng)
      const { slug, orgId, oib } = await onboard(ownerUser, { phone: '', iban })
      const invitedEmail = `audit-${randomBytes(4).toString('hex')}@example.test`
      const invited = await makeUser({ email: invitedEmail })

      const profileUpdate = await as(ownerUser, () =>
        actions.updateObrtProfile({
          ...profileInput({ iban }),
          orgSlug: slug,
          oib: fakeOib(rng), // posted, must be ignored
          tradeName: 'Promijenjeno Ime',
          city: 'Split',
        }),
      )
      expect(profileUpdate.ok).toBe(true)
      const unchanged = await asTenant(app, orgId, (c) =>
        c.query<{ oib: string; city: string; trade_name: string }>(
          'select oib, city, trade_name from obrt_profiles',
        ),
      )
      expect(unchanged.rows[0]).toMatchObject({
        oib,
        city: 'Split',
        trade_name: 'Promijenjeno Ime',
      })
      const orgName = await owner.query<{ name: string }>(
        'select name from organization where id = $1',
        [orgId],
      )
      expect(orgName.rows[0]?.name).toBe('Promijenjeno Ime')

      const invite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitedEmail, role: 'accountant' }),
      )
      const invitationId = invite.ok ? invite.data.invitationId : ''
      const accept = await as(invited, () => actions.acceptInvitation({ invitationId }))
      expect(accept.ok).toBe(true)
      const memberId = await memberIdOf(orgId, invited.id)
      expect(
        (
          await as(ownerUser, () =>
            actions.changeMemberRole({ orgSlug: slug, memberId, role: 'member' }),
          )
        ).ok,
      ).toBe(true)
      // A second invitation that is revoked, then the member is removed.
      const second = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: 'second@example.test', role: 'member' }),
      )
      expect(
        (
          await as(ownerUser, () =>
            actions.revokeInvitation({
              orgSlug: slug,
              invitationId: second.ok ? second.data.invitationId : '',
            }),
          )
        ).ok,
      ).toBe(true)
      expect(
        (await as(ownerUser, () => actions.removeMember({ orgSlug: slug, memberId }))).ok,
      ).toBe(true)

      const rows = await auditRows(orgId)
      expect(rows.map((r) => [r.action, r.entity_type, r.changed_fields])).toEqual([
        ['org.created', 'organization', ['name', 'slug']],
        ['obrt_profile.updated', 'obrt_profile', ['tradeName', 'city']],
        ['member.invited', 'invitation', ['email', 'role', 'status']],
        ['member.joined', 'member', ['role']],
        ['member.role_changed', 'member', ['role']],
        ['member.invited', 'invitation', ['email', 'role', 'status']],
        ['member.invitation_revoked', 'invitation', ['status']],
        ['member.removed', 'member', []],
      ])
      // Entity ids are ids, never an e-mail or an OIB; nothing in a row holds a value.
      const dump = JSON.stringify(rows)
      expect(dump).not.toContain(invitedEmail)
      expect(dump).not.toContain('second@example.test')
      expect(dump).not.toContain(oib)
      expect(dump).not.toContain('Promijenjeno')
      expect(dump).not.toContain('Split')
      expect(rows.every((r) => r.actor_user_id.length > 0 && !r.entity_id.includes('@'))).toBe(true)
    })

    it('writes no row when nothing changes, and rolls back when Better Auth refuses', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const memberUser = await makeUser()
      await addViaInvitation(ownerUser, slug, memberUser, 'member')
      const memberId = await memberIdOf(orgId, memberUser.id)
      const before = (await auditRows(orgId)).length

      // Same role: no change, no row.
      expect(
        (
          await as(ownerUser, () =>
            actions.changeMemberRole({ orgSlug: slug, memberId, role: 'member' }),
          )
        ).ok,
      ).toBe(true)
      // Same profile values: no change, no row.
      const current = await asTenant(app, orgId, (c) => c.query('select * from obrt_profiles'))
      const row = current.rows[0]
      expect(
        (
          await as(ownerUser, () =>
            actions.updateObrtProfile({
              orgSlug: slug,
              tradeName: row.trade_name,
              ownerFullName: row.owner_full_name,
              street: row.street,
              postalCode: row.postal_code,
              city: row.city,
              countryCode: row.country_code,
              iban: row.iban,
              email: row.email,
              phone: '',
              website: '',
              defaultInvoiceNote: row.default_invoice_note,
            }),
          )
        ).ok,
      ).toBe(true)
      expect((await auditRows(orgId)).length).toBe(before)

      // Inviting an existing member: Better Auth refuses, the invitation is not created.
      const dup = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: memberUser.email, role: 'member' }),
      )
      expect(dup).toEqual({ ok: false, message: 'Ta osoba već je član obrta.' })
      expect((await auditRows(orgId)).length).toBe(before)
    })
  })

  // --- plan item 13: invitations ---------------------------------------------------------------

  describe('invitations', () => {
    it('sends the email with the /pozivnica/<id> link and accepting adds the member with the invited role', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const send = vi.mocked(transport.sendMail)
      send.mockClear()
      const invite = await as(ownerUser, () =>
        actions.inviteMember({
          orgSlug: slug,
          email: invitee.email.toUpperCase(),
          role: 'accountant',
        }),
      )
      expect(invite.ok).toBe(true)
      if (!invite.ok) return
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      const mail = send.mock.calls[0]![0]
      expect(mail.to).toBe(invitee.email)
      expect(mail.text).toContain(`${BASE_URL}/pozivnica/${invite.data.invitationId}`)

      const accepted = await as(invitee, () =>
        actions.acceptInvitation({ invitationId: invite.data.invitationId }),
      )
      expect(accepted).toEqual({ ok: true, data: { orgSlug: slug } })
      expect(await roleOf(orgId, invitee.id)).toBe('accountant')
      // Used up: a second accept fails.
      expect(
        await as(invitee, () =>
          actions.acceptInvitation({ invitationId: invite.data.invitationId }),
        ),
      ).toEqual({
        ok: false,
        message: messages.INVITATION_MESSAGES.used,
      })
    })

    it('matches the verified email case-insensitively', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const local = `Mixed${randomBytes(4).toString('hex')}`
      const invitee = await makeUser({ storedEmail: `${local}@Example.test` })
      const invite = await as(ownerUser, () =>
        actions.inviteMember({
          orgSlug: slug,
          email: `${local.toLowerCase()}@example.test`,
          role: 'member',
        }),
      )
      expect(invite.ok).toBe(true)
      const accepted = await as(invitee, () =>
        actions.acceptInvitation({ invitationId: invite.ok ? invite.data.invitationId : '' }),
      )
      expect(accepted.ok).toBe(true)
      expect(await roleOf(orgId, invitee.id)).toBe('member')
    })

    it('refuses a different verified email without revealing who the invitation was for', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser, { tradeName: 'Povjerljivi Obrt' })
      const rightEmail = `right-${randomBytes(4).toString('hex')}@example.test`
      const invite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: rightEmail, role: 'member' }),
      )
      const invitationId = invite.ok ? invite.data.invitationId : ''
      const stranger = await makeUser()

      const result = await as(stranger, () => actions.acceptInvitation({ invitationId }))
      expect(result).toEqual({ ok: false, message: 'Pozivnica je poslana na drugu adresu.' })
      expect(JSON.stringify(result)).not.toContain('right-')
      expect(JSON.stringify(result)).not.toContain('Povjerljivi')
      expect(await roleOf(orgId, stranger.id)).toBeUndefined()
      expect(await as(stranger, () => actions.declineInvitation({ invitationId }))).toEqual(result)

      // The page data for the wrong recipient carries no organization or address either.
      const queries = await import('@/server/org/queries')
      const view = await queries.getInvitationView(stranger, invitationId)
      expect(view).toEqual({ state: 'wrong_recipient' })
      // An unknown id is a different, equally empty answer.
      expect(await queries.getInvitationView(stranger, 'x'.repeat(32))).toEqual({
        state: 'unavailable',
      })
      expect(
        await as(stranger, () => actions.acceptInvitation({ invitationId: 'x'.repeat(32) })),
      ).toEqual({
        ok: false,
        message: messages.INVITATION_MESSAGES.unavailable,
      })
      expect(
        await as(stranger, () => actions.acceptInvitation({ invitationId: '../../etc' })),
      ).toEqual({
        ok: false,
        message: messages.INVITATION_MESSAGES.unavailable,
      })
    })

    it('rejects expired and revoked invitations', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const expiredUser = await makeUser()
      const revokedUser = await makeUser()

      const expiredInvite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: expiredUser.email, role: 'member' }),
      )
      const expiredId = expiredInvite.ok ? expiredInvite.data.invitationId : ''
      await owner.query(
        `update invitation set expires_at = now() - interval '1 minute' where id = $1`,
        [expiredId],
      )
      expect(
        await as(expiredUser, () => actions.acceptInvitation({ invitationId: expiredId })),
      ).toEqual({
        ok: false,
        message: messages.INVITATION_MESSAGES.expired,
      })

      const revokedInvite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: revokedUser.email, role: 'member' }),
      )
      const revokedId = revokedInvite.ok ? revokedInvite.data.invitationId : ''
      expect(
        (
          await as(ownerUser, () =>
            actions.revokeInvitation({ orgSlug: slug, invitationId: revokedId }),
          )
        ).ok,
      ).toBe(true)
      expect(
        await as(revokedUser, () => actions.acceptInvitation({ invitationId: revokedId })),
      ).toEqual({
        ok: false,
        message: messages.INVITATION_MESSAGES.revoked,
      })
      expect(await roleOf(orgId, expiredUser.id)).toBeUndefined()
      expect(await roleOf(orgId, revokedUser.id)).toBeUndefined()
    })

    it('declining marks the invitation and adds nobody', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const invite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'member' }),
      )
      const invitationId = invite.ok ? invite.data.invitationId : ''
      expect((await as(invitee, () => actions.declineInvitation({ invitationId }))).ok).toBe(true)
      expect(await roleOf(orgId, invitee.id)).toBeUndefined()
      expect(await as(invitee, () => actions.acceptInvitation({ invitationId }))).toEqual({
        ok: false,
        message: messages.INVITATION_MESSAGES.declined,
      })
    })
  })

  // --- pool exhaustion, lock timeout, mail failure (review item B1) ----------------------------

  describe('concurrency and failure handling of member changes', () => {
    it('settles more concurrent mutations than the pool has connections, without hanging', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const target = await makeUser()
      await addViaInvitation(ownerUser, slug, target, 'member')
      const memberId = await memberIdOf(orgId, target.id)
      // The pool has 10 connections. Better Auth is no longer called inside the transaction, so
      // the lock holder never needs a second one: all of these must settle.
      const invites = 14
      const flips = 6
      const started = Date.now()
      const settled = await Promise.allSettled([
        ...Array.from({ length: invites }, (_, i) =>
          as(ownerUser, () =>
            actions.inviteMember({
              orgSlug: slug,
              email: `burst-${i}-${randomBytes(4).toString('hex')}@example.test`,
              role: 'member',
            }),
          ),
        ),
        ...Array.from({ length: flips }, (_, i) =>
          as(ownerUser, () =>
            actions.changeMemberRole({
              orgSlug: slug,
              memberId,
              role: i % 2 === 0 ? 'accountant' : 'member',
            }),
          ),
        ),
      ])
      expect(Date.now() - started).toBeLessThan(15_000)
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true)
      const results = settled.map((r) => (r.status === 'fulfilled' ? r.value : null))
      expect(results.every((r) => r?.ok === true)).toBe(true)
      const { rows } = await owner.query<{ n: string }>(
        `select count(*) as n from invitation where organization_id = $1 and status = 'pending'`,
        [orgId],
      )
      expect(Number(rows[0]!.n)).toBe(invites)
    })

    it('answers a lock timeout with the retry message, and the pool stays usable', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const target = await makeUser()
      await addViaInvitation(ownerUser, slug, target, 'member')
      const memberId = await memberIdOf(orgId, target.id)
      const blocker = await owner.connect()
      try {
        await blocker.query('begin')
        await blocker.query('select id from organization where id = $1 for update', [orgId])
        const started = Date.now()
        const result = await as(ownerUser, () =>
          actions.changeMemberRole({ orgSlug: slug, memberId, role: 'accountant' }),
        )
        expect(result).toEqual({ ok: false, message: 'Došlo je do pogreške. Pokušajte ponovno.' })
        expect(Date.now() - started).toBeLessThan(10_000)
      } finally {
        await blocker.query('rollback')
        blocker.release()
      }
      expect(await roleOf(orgId, target.id)).toBe('member')
      // Lock released: the same call now works.
      expect(
        (
          await as(ownerUser, () =>
            actions.changeMemberRole({ orgSlug: slug, memberId, role: 'accountant' }),
          )
        ).ok,
      ).toBe(true)
    }, 30_000)

    it('keeps the invitation when the email cannot be sent, reports a retryable error, and a retry resends', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const address = `mailfail-${randomBytes(4).toString('hex')}@example.test`
      const send = vi.mocked(transport.sendMail)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        send.mockRejectedValueOnce(new Error(`550 mailbox ${address} unavailable`))
        const failed = await as(ownerUser, () =>
          actions.inviteMember({ orgSlug: slug, email: address, role: 'member' }),
        )
        expect(failed).toEqual({
          ok: false,
          message:
            'Pozivnica je spremljena, ali e-pošta nije poslana. Pokušajte ponovno poslati pozivnicu.',
        })
        const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join('\n')
        expect(logged).toContain('invitation email failed')
        expect(logged).not.toContain(address)
      } finally {
        errorSpy.mockRestore()
        logSpy.mockRestore()
      }
      const stored = await owner.query<{ id: string; status: string }>(
        'select id, status from invitation where organization_id = $1',
        [orgId],
      )
      expect(stored.rows).toHaveLength(1)
      expect(stored.rows[0]?.status).toBe('pending')
      expect((await auditRows(orgId)).map((r) => r.action)).toContain('member.invited')

      send.mockClear()
      const retry = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: address, role: 'member' }),
      )
      expect(retry).toEqual({ ok: true, data: { invitationId: stored.rows[0]!.id } })
      expect(send).toHaveBeenCalledTimes(1)
    })
  })

  // --- re-inviting a pending address (review item S3) ------------------------------------------

  describe('inviting an address that already has a pending invitation', () => {
    it('with the same role extends the expiry on the same row and resends the email', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const address = `again-${randomBytes(4).toString('hex')}@example.test`
      const first = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: address, role: 'member' }),
      )
      const id = first.ok ? first.data.invitationId : ''
      await owner.query(
        `update invitation set expires_at = now() + interval '1 hour' where id = $1`,
        [id],
      )
      const send = vi.mocked(transport.sendMail)
      send.mockClear()
      const again = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: address.toUpperCase(), role: 'member' }),
      )
      expect(again).toEqual({ ok: true, data: { invitationId: id } })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]![0].text).toContain(`/pozivnica/${id}`)
      const { rows } = await owner.query<{ role: string; status: string; hours: number }>(
        `select role, status, extract(epoch from (expires_at - now())) / 3600 as hours
           from invitation where organization_id = $1`,
        [orgId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ role: 'member', status: 'pending' })
      expect(Number(rows[0]!.hours)).toBeGreaterThan(47)
      const audit = await auditRows(orgId)
      expect(audit.at(-1)).toMatchObject({
        action: 'member.invited',
        entity_id: id,
        changed_fields: ['expiresAt'],
      })
    })

    it('with a different role updates the role, so the person joins with the role chosen last', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const first = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'member' }),
      )
      const id = first.ok ? first.data.invitationId : ''
      const send = vi.mocked(transport.sendMail)
      send.mockClear()
      const second = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'accountant' }),
      )
      expect(second).toEqual({ ok: true, data: { invitationId: id } })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]![0].text).toContain('knjigovođa')
      const { rows } = await owner.query<{ role: string }>(
        'select role from invitation where organization_id = $1',
        [orgId],
      )
      expect(rows).toEqual([{ role: 'accountant' }])
      expect((await auditRows(orgId)).at(-1)).toMatchObject({
        action: 'member.invited',
        changed_fields: ['role', 'expiresAt'],
      })
      expect((await as(invitee, () => actions.acceptInvitation({ invitationId: id }))).ok).toBe(
        true,
      )
      expect(await roleOf(orgId, invitee.id)).toBe('accountant')
    })

    it('does not touch an invitation that was accepted between the read and the update', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const first = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'member' }),
      )
      const id = first.ok ? first.data.invitationId : ''
      const auditBefore = (await auditRows(orgId)).length
      const send = vi.mocked(transport.sendMail)
      send.mockClear()

      // Hold the invitation row, so the action reads it as pending and then waits at its UPDATE;
      // marking it accepted and releasing the row replays the race with acceptInvitation.
      const blocker = await owner.connect()
      let reinvite: Promise<Awaited<ReturnType<typeof actions.inviteMember>>>
      try {
        const pidResult = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
        const blockerPid = pidResult.rows[0]!.pid
        await blocker.query('begin')
        await blocker.query('select id from invitation where id = $1 for update', [id])
        reinvite = as(ownerUser, () =>
          actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'accountant' }),
        )
        await vi.waitFor(
          async () => {
            const { rowCount } = await owner.query(
              'select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
              [blockerPid],
            )
            expect(rowCount).toBeGreaterThan(0)
          },
          { timeout: 4000, interval: 25 },
        )
        await blocker.query(`update invitation set status = 'accepted' where id = $1`, [id])
        await blocker.query('commit')
      } catch (error) {
        await blocker.query('rollback').catch(() => {})
        throw error
      } finally {
        blocker.release()
      }
      expect(await reinvite).toEqual({ ok: false, message: messages.INVITATION_MESSAGES.used })
      const { rows } = await owner.query<{ role: string; status: string }>(
        'select role, status from invitation where id = $1',
        [id],
      )
      expect(rows).toEqual([{ role: 'member', status: 'accepted' }])
      expect((await auditRows(orgId)).length).toBe(auditBefore)
      expect(send).not.toHaveBeenCalled()
    })
  })

  // --- orphan organizations (review items S4, N4) ----------------------------------------------

  /** Organizations of the user without a profile (profiles are read through their tenant). */
  async function orphanCount(userId: string): Promise<number> {
    const { rows } = await owner.query<{ organization_id: string }>(
      'select organization_id from member where user_id = $1',
      [userId],
    )
    let orphans = 0
    for (const { organization_id } of rows) {
      const profiles = await asTenant(app, organization_id, (c) =>
        c.query('select 1 from obrt_profiles'),
      )
      if (profiles.rowCount === 0) orphans++
    }
    return orphans
  }
  async function membershipCount(userId: string): Promise<number> {
    const { rows } = await owner.query<{ n: string }>(
      'select count(*) as n from member where user_id = $1',
      [userId],
    )
    return Number(rows[0]!.n)
  }

  describe('orphan organizations', () => {
    async function makeOrphan(user: TestUser) {
      const created = await authModule.getAuth().api.createOrganization({
        body: {
          name: 'Siroče',
          slug: `siroce-${randomBytes(3).toString('hex')}`,
          userId: user.id,
        },
      })
      return { slug: created.slug, orgId: created.id }
    }
    async function hasProfile(orgId: string): Promise<boolean> {
      const rows = await asTenant(app, orgId, (c) => c.query('select 1 from obrt_profiles'))
      return (rows.rowCount ?? 0) > 0
    }
    async function seedMember(orgId: string, userId: string, role: string) {
      await owner.query(
        `insert into member (id, organization_id, user_id, role, created_at)
         values ($1, $2, $3, $4, now())`,
        [`m${randomBytes(15).toString('hex')}`, orgId, userId, role],
      )
    }

    it('refuses member management while the organization has no profile', async () => {
      const x = await makeUser()
      const { slug, orgId } = await makeOrphan(x)
      const xMemberId = await memberIdOf(orgId, x.id)
      const results = await Promise.all([
        as(x, () =>
          actions.inviteMember({ orgSlug: slug, email: 'y@example.test', role: 'member' }),
        ),
        as(x, () =>
          actions.changeMemberRole({ orgSlug: slug, memberId: xMemberId, role: 'member' }),
        ),
        as(x, () => actions.removeMember({ orgSlug: slug, memberId: xMemberId })),
      ])
      for (const result of results) {
        expect(result).toEqual({ ok: false, message: messages.PROFILE_FIRST_MESSAGE })
      }
      const { rowCount } = await owner.query(
        'select 1 from invitation where organization_id = $1',
        [orgId],
      )
      expect(rowCount).toBe(0)
      expect(await roleOf(orgId, x.id)).toBe('owner')
    })

    it("does not reuse an orphan that has another member: the victim's data never lands in it", async () => {
      const x = await makeUser()
      const y = await makeUser()
      const { slug, orgId } = await makeOrphan(x)
      // The invitation path is closed (above), so Y is seeded directly, as an owner (the worst
      // case: the attacker made the victim an owner of the orphan).
      await seedMember(orgId, y.id, 'owner')

      // Y onboards: a new organization, not X's.
      const yResult = await as(y, () => actions.createOrganizationWithProfile(profileInput()))
      expect(yResult.ok).toBe(true)
      if (!yResult.ok) return
      expect(yResult.data.orgSlug).not.toBe(slug)
      expect(await hasProfile(orgId)).toBe(false)
      expect(await membershipCount(y.id)).toBe(2)

      // Y may not finish X's organization by slug either, nor can X (no longer alone in it).
      for (const user of [y, x]) {
        const viaSlug = await as(user, () =>
          actions.createOrganizationWithProfile(profileInput({ existingOrgSlug: slug })),
        )
        expect(viaSlug).toEqual({ ok: false, message: messages.PROFILE_FIRST_MESSAGE })
      }
      // The check under the organization lock catches it even if the up-front one is bypassed.
      mocks.forceSole.on = true
      try {
        const forced = await as(y, () =>
          actions.createOrganizationWithProfile(profileInput({ existingOrgSlug: slug })),
        )
        expect(forced).toEqual({ ok: false, message: messages.PROFILE_FIRST_MESSAGE })
      } finally {
        mocks.forceSole.on = false
      }
      expect(await hasProfile(orgId)).toBe(false)
      const xResult = await as(x, () => actions.createOrganizationWithProfile(profileInput()))
      expect(xResult.ok && xResult.data.orgSlug).not.toBe(slug)
      expect(await hasProfile(orgId)).toBe(false)
    })

    it('the layout does not bounce a co-member of a profile-less organization to onboarding', async () => {
      const x = await makeUser()
      const y = await makeUser()
      const { slug, orgId } = await makeOrphan(x)
      const { default: OrgLayout } = await import('@/app/app/[org]/layout')
      await expect(
        as(x, () => OrgLayout({ children: null, params: Promise.resolve({ org: slug }) })),
      ).rejects.toThrow(`NEXT_REDIRECT:/app/novi-obrt?org=${slug}`)
      await seedMember(orgId, y.id, 'owner')
      for (const user of [x, y]) {
        await expect(
          as(user, () => OrgLayout({ children: null, params: Promise.resolve({ org: slug }) })),
        ).resolves.toBeTruthy()
      }
    })

    it('a submit that loses the OIB race leaves one orphan, and the retry finishes it instead of creating another', async () => {
      const holder = await makeUser()
      const { oib } = await onboard(holder)
      const loser = await makeUser()
      // The pre-check is stubbed away, so the unique constraint (23505) really decides.
      mocks.skipOibCheck.on = true
      let raced
      try {
        raced = await as(loser, () => actions.createOrganizationWithProfile(profileInput({ oib })))
      } finally {
        mocks.skipOibCheck.on = false
      }
      expect(raced).toEqual({
        ok: false,
        message: schemas.OIB_TAKEN_MESSAGE,
        fieldErrors: { oib: schemas.OIB_TAKEN_MESSAGE },
      })
      expect(await membershipCount(loser.id)).toBe(1)
      expect(await orphanCount(loser.id)).toBe(1)

      const retry = await as(loser, () =>
        actions.createOrganizationWithProfile(profileInput({ tradeName: 'Ponovni Pokušaj' })),
      )
      expect(retry.ok).toBe(true)
      expect(await membershipCount(loser.id)).toBe(1)
      expect(await orphanCount(loser.id)).toBe(0)
      // N4: the reused organization carries the new trade name.
      const { rows } = await owner.query<{ name: string }>(
        `select o.name from organization o join member m on m.organization_id = o.id
          where m.user_id = $1`,
        [loser.id],
      )
      expect(rows).toEqual([{ name: 'Ponovni Pokušaj' }])
    })

    it('a double submit creates one organization', async () => {
      const user = await makeUser()
      const input = profileInput()
      const first = await as(user, () => actions.createOrganizationWithProfile(input))
      expect(first.ok).toBe(true)
      const second = await as(user, () => actions.createOrganizationWithProfile(input))
      expect(second).toMatchObject({ ok: false, message: schemas.OIB_TAKEN_MESSAGE })
      expect(await membershipCount(user.id)).toBe(1)
      expect(await orphanCount(user.id)).toBe(0)
    })

    it('concurrent double submits leave at most one orphan, which the next submit reuses', async () => {
      const user = await makeUser()
      const input = profileInput()
      const results = await Promise.all([
        as(user, () => actions.createOrganizationWithProfile(input)),
        as(user, () => actions.createOrganizationWithProfile(input)),
      ])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(await orphanCount(user.id)).toBeLessThanOrEqual(1)
      const before = await membershipCount(user.id)
      const next = await as(user, () => actions.createOrganizationWithProfile(profileInput()))
      expect(next.ok).toBe(true)
      expect(await orphanCount(user.id)).toBe(0)
      // A second profile needed an organization: the orphan (if any) was reused, none was added.
      expect(await membershipCount(user.id)).toBe(Math.max(before, 2))
    })
  })

  // --- accepting twice, audit failure after accepting -------------------------------------------

  describe('accepting an invitation', () => {
    it('two concurrent accepts: one wins, the other gets a clean message, one member exists', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const invite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'member' }),
      )
      const invitationId = invite.ok ? invite.data.invitationId : ''
      const results = await Promise.all([
        as(invitee, () => actions.acceptInvitation({ invitationId })),
        as(invitee, () => actions.acceptInvitation({ invitationId })),
      ])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      const loser = results.find((r) => !r.ok)
      const clean = [
        messages.INVITATION_MESSAGES.unavailable,
        messages.INVITATION_MESSAGES.used,
        messages.INVITATION_MESSAGES.already_member,
      ]
      expect(loser && !loser.ok && clean.includes(loser.message)).toBe(true)
      const { rows } = await owner.query<{ n: string }>(
        'select count(*) as n from member where organization_id = $1 and user_id = $2',
        [orgId, invitee.id],
      )
      expect(Number(rows[0]!.n)).toBe(1)
      const joined = (await auditRows(orgId)).filter((r) => r.action === 'member.joined')
      expect(joined).toHaveLength(1)
    })

    it('still succeeds, and logs the member id only, when the member.joined audit row cannot be written', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const invite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'member' }),
      )
      const invitationId = invite.ok ? invite.data.invitationId : ''
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mocks.failJoinedAudit.on = true
      let accepted
      try {
        accepted = await as(invitee, () => actions.acceptInvitation({ invitationId }))
        const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join('\n')
        expect(logged).toContain('member.joined audit row not written')
        expect(logged).toContain(await memberIdOf(orgId, invitee.id))
        expect(logged).not.toContain(invitee.email)
      } finally {
        mocks.failJoinedAudit.on = false
        errorSpy.mockRestore()
        logSpy.mockRestore()
      }
      expect(accepted).toEqual({ ok: true, data: { orgSlug: slug } })
      expect(await roleOf(orgId, invitee.id)).toBe('member')
    })

    it('an address that became unverified is sent to e-mail confirmation and accepts nothing', async () => {
      const ownerUser = await makeUser()
      const { slug, orgId } = await onboard(ownerUser)
      const invitee = await makeUser()
      const invite = await as(ownerUser, () =>
        actions.inviteMember({ orgSlug: slug, email: invitee.email, role: 'member' }),
      )
      const invitationId = invite.ok ? invite.data.invitationId : ''
      // A real, signed session; only the verification flag is flipped. Better Auth reads the user
      // from the database on every request (no cookie cache), so requireUser sees the change.
      await owner.query('update "user" set email_verified = false where id = $1', [invitee.id])
      await expect(as(invitee, () => actions.acceptInvitation({ invitationId }))).rejects.toThrow(
        'NEXT_REDIRECT:/potvrda-emaila',
      )
      expect(await roleOf(orgId, invitee.id)).toBeUndefined()
      // Verified again: the very same session and invitation work, so the flag was what decided.
      await owner.query('update "user" set email_verified = true where id = $1', [invitee.id])
      expect((await as(invitee, () => actions.acceptInvitation({ invitationId }))).ok).toBe(true)
    })
  })

  // --- the HTTP bypass is closed ---------------------------------------------------------------

  describe('Better Auth HTTP routes', () => {
    it('returns 404 for every /organization/* route (writes and the slug/membership oracles), while the handler still serves others', async () => {
      const ownerUser = await makeUser()
      const { orgId, slug } = await onboard(ownerUser)
      const auth = authModule.getAuth()
      const handler = auth.handler
      // Enumerate the plugin's own endpoints, so a route added by a Better Auth upgrade fails here
      // until it is listed in disabledPaths.
      const endpoints = Object.values(auth.api as Record<string, unknown>).flatMap((entry) => {
        const endpoint = entry as { path?: string; options?: { method?: string | string[] } }
        if (!endpoint?.path?.startsWith('/organization/')) return []
        const method = [endpoint.options?.method ?? 'GET'].flat()[0]
        return [{ path: endpoint.path, method: method === 'POST' ? 'POST' : 'GET' }]
      })
      // 22 are registered with this plugin configuration (teams and dynamic roles are off).
      expect(endpoints.length).toBeGreaterThan(15)
      expect(endpoints.map((e) => e.path)).toContain('/organization/check-slug')
      for (const { path, method } of endpoints) {
        for (const cookie of [ownerUser.headers.get('cookie') ?? '', '']) {
          const url = new URL(`${BASE_URL}/api/auth${path}`)
          if (method === 'GET') {
            url.searchParams.set('slug', slug)
            url.searchParams.set('organizationId', orgId)
          }
          const response = await handler(
            new Request(url, {
              method,
              headers: { 'content-type': 'application/json', origin: BASE_URL, cookie },
              ...(method === 'POST'
                ? { body: JSON.stringify({ organizationId: orgId, slug }) }
                : {}),
            }),
          )
          expect(response.status, path).toBe(404)
        }
      }
      const session = await handler(
        new Request(`${BASE_URL}/api/auth/get-session`, {
          headers: { cookie: ownerUser.headers.get('cookie') ?? '' },
        }),
      )
      expect(session.status).toBe(200)
    })
  })
})
