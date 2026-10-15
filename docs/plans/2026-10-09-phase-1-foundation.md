# Phase 1: Foundation (accounts, obrt, tenancy, customers, items)

**Status:** Approved (2026-10-09)

Date: 2026-10-09. Author: `architect`. Parent plan: `docs/plans/2026-10-09-product-roadmap.md` (Phase 1).

**Approval notes.** The user approved starting with the architect's recommendations. The open questions at the end are answered with the recommended defaults below; the user can still change them:

1. Roles: owner / accountant / member with the matrix as written; accountants view but don't edit the obrt profile.
2. 2FA is optional in Phase 1; Phase 3 requires it for owners before certificate upload.
3. Sign-up is open while the app runs only locally. Decide on invite-only before any deployment.
4. A non-HR IBAN is allowed with a visible warning.
5. Croatian URL paths are fine.
6. Hosting is not approved, so step 11 is skipped.
7. No OIB is collected for private customers.
8. One obrt per OIB, with the "ask the owner for an invitation" message.
9. Zajednički obrt (co-owners) is out of scope for the MVP.

**Local infrastructure (user decision, 2026-10-09).** This machine has no Docker. Step 2 replaces `docker-compose.yml` with a project-local PostgreSQL 17 run by the `embedded-postgres` npm package and an npm-based mail catcher in place of Mailpit. Integration tests start their own throwaway PostgreSQL instance. Docker returns only for deployment (step 11, later phases).

**Precondition:** the user has approved the roadmap's recommendations for database/ORM (PostgreSQL 17 + Drizzle), auth (Better Auth), styling (Tailwind v4 + shadcn/ui) and test stack (Vitest + Playwright). Hosting is needed only for the optional step 11. If any of these change, this plan must be revised before implementation starts.

## Goal

A paušalni obrtnik can register (email + password, verified email, optional TOTP 2FA), set up their obrt (OIB, address, IBAN, non-VAT invoice note), invite an accountant, and maintain customers and a catalogue of products and services. Every piece of data is scoped to the organization, audited, and shown in Croatian. Underneath, the money, parsing, date and validation libraries and the tenant-isolation layer that every later phase depends on are in place and tested.

## Out of scope

- Quotes, invoices, credit notes, numbering, business premises and devices (Phase 2)
- PDF, HUB3, sending document emails, logo upload, object storage (Phase 2)
- Fiscalization, certificates, KMS (Phase 3); eRačun, KPD catalogue lookup (Phase 4). Phase 1 only validates the KPD code **format**.
- Bank import, payments, KPR, tax parameters (Phase 5)
- Our own subscriptions and billing, GDPR export and account deletion, enforced CSP, admin back office (Phase 6)
- pg-boss and the worker process. Phase 1 sends auth emails inline.
- Passkeys, social login, NIAS/e-Građani login, magic links
- VAT-registered obrtnici. Onboarding blocks them with an explanation.
- Production deployment. Step 11 (container image and staging) runs only if hosting is approved.

## Data model changes

All timestamps are `timestamptz`, stored in UTC and shown in `Europe/Zagreb`. Phase 1 has no money amounts in minor units. The only monetary value is `items.unit_price`, a **unit price**, which `CLAUDE.md` allows to be more precise than cents. It is stored as `numeric(19,6)` and read and written as a **decimal string**, never as a JS number.

### Database roles (local and every environment)

- `pf_owner` owns the schema and runs migrations (`DATABASE_MIGRATION_URL`).
- `pf_app` is the runtime role (`DATABASE_URL`). It is `NOSUPERUSER NOBYPASSRLS` and not the owner of any table.
- `pf_definer` is a `NOLOGIN NOSUPERUSER BYPASSRLS` role granted to `pf_owner`. It owns `SECURITY DEFINER` functions that must look across tenants (`oib_is_registered`), because under `FORCE ROW LEVEL SECURITY` a function owned by `pf_owner` only sees the caller's org. It gets column-level `SELECT (oib) ON obrt_profiles` and nothing else. Only a superuser can create a `BYPASSRLS` role, so it is created in `scripts/db/init.sql` (and in every environment's bootstrap), not in a migration. *(Added after the step 2 review.)*
- Definer functions: `REVOKE EXECUTE … FROM PUBLIC`, `GRANT EXECUTE` to `pf_app` only, `SET search_path = pg_catalog, pg_temp`, and schema-qualified names inside.
- Transferring a function to `pf_definer` requires the new owner to have `CREATE` on the schema. The migration (run as `pf_owner`) does, in order (set the EXECUTE grants on `oib_is_registered` before transferring its ownership to `pf_definer`): `GRANT CREATE ON SCHEMA public TO pf_definer`, `ALTER FUNCTION public.oib_is_registered(text) OWNER TO pf_definer`, `REVOKE CREATE ON SCHEMA public FROM pf_definer`. Ownership survives the revoke. An integration test must prove the function sees another org's OIB under FORCE RLS. *(Added after the step 2 re-review.)*
- Under FORCE RLS, data migrations run by `pf_owner` see 0 rows unless they set `app.org_id`.
- Grants:
  - `pf_app` gets `SELECT, INSERT, UPDATE, DELETE` on Better Auth tables;
  - `SELECT, INSERT, UPDATE` on `obrt_profiles`, `customers`, `items` (no `DELETE`: archiving only);
  - `SELECT, INSERT` on `audit_log`.

### Better Auth tables (generated)

Generate with the Better Auth CLI into `src/server/db/schema/auth.ts`, with the `organization` and `twoFactor` plugins enabled: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `twoFactor`. Keep Better Auth's default **text** ids. These tables have no RLS. The developer checks the exact generated shape against the Better Auth docs version in use; nothing else in this plan depends on their internals except `organization.id`, `organization.slug`, `member.organizationId/userId/role`.

### `obrt_profiles`

One row per organization, created during onboarding.

| Column | Type | Rules |
|---|---|---|
| `organization_id` | `text` PK, FK → `organization.id` | |
| `trade_name` | `text NOT NULL` | Naziv obrta, 1–200 chars |
| `owner_full_name` | `text NOT NULL` | 1–200 chars |
| `oib` | `char(11) NOT NULL` | ISO 7064 MOD 11,10 valid; `UNIQUE` across all orgs (one obrt per OIB) |
| `street` | `text NOT NULL` | 1–200 |
| `postal_code` | `text NOT NULL` | `^\d{5}$` |
| `city` | `text NOT NULL` | 1–100 |
| `country_code` | `char(2) NOT NULL DEFAULT 'HR'` | Must be `HR` in the MVP |
| `iban` | `text NOT NULL` | Stored uppercase without spaces; mod-97 valid; see open question 4 for non-HR |
| `email` | `text NOT NULL` | Shown on invoices |
| `phone` | `text NULL` | |
| `website` | `text NULL` | |
| `in_vat_system` | `boolean NOT NULL DEFAULT false` | `CHECK (in_vat_system = false)` in the MVP |
| `default_invoice_note` | `text NOT NULL` | Default: `Obveznik nije u sustavu PDV-a, PDV nije obračunat temeljem čl. 90. st. 1. Zakona o PDV-u.` (wording pending tax-advisor confirmation; see roadmap 2.5) |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `updated_at` is set by the app on update |

RLS: `organization_id = current_setting('app.org_id', true)` for USING and WITH CHECK.

### `customers`

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | |
| `organization_id` | `text NOT NULL` FK → `organization.id` | `UNIQUE (organization_id, id)` so later tables can use composite FKs |
| `kind` | `text NOT NULL CHECK (kind IN ('person','business'))` | |
| `name` | `text NOT NULL` | 1–200 |
| `oib` | `char(11) NULL` | Valid if present. **Required** when `kind='business' AND country_code='HR'`. **Not collected** for persons by default (data minimization; see open question 7). |
| `vat_id` | `text NULL` | For foreign businesses: `^[A-Z]{2}[A-Z0-9]{2,13}$`, upper-cased. No VIES call in Phase 1. |
| `street`, `postal_code`, `city` | `text NULL` | All three required for `business`; optional for `person` |
| `country_code` | `char(2) NOT NULL DEFAULT 'HR'` | ISO 3166-1 alpha-2 from a fixed list |
| `email` | `text NULL` | |
| `note` | `text NULL` | ≤ 1000 chars, internal |
| `archived_at` | `timestamptz NULL` | Archiving replaces deletion |
| `created_at`, `updated_at` | `timestamptz NOT NULL` | |

- Index: `UNIQUE (organization_id, oib) WHERE oib IS NOT NULL AND archived_at IS NULL`.
- Index: `(organization_id, lower(name))` for listing.
- RLS as above. The constraint for `oib` on HR businesses is enforced in zod **and** with a `CHECK (NOT (kind='business' AND country_code='HR' AND oib IS NULL))`.

### `items` (products and services)

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` PK | |
| `organization_id` | `text NOT NULL` | `UNIQUE (organization_id, id)` |
| `name` | `text NOT NULL` | 1–200 |
| `description` | `text NULL` | ≤ 1000 |
| `unit_code` | `text NOT NULL` | One of the UN/ECE Rec 20 codes in `src/server/items/units.ts`: `H87` (kom), `HUR` (sat), `DAY` (dan), `MON` (mjesec), `C62` (jedinica), `KGM` (kg), `MTR` (m), `LTR` (l), `MTK` (m²), `KMT` (km). Croatian labels shown. |
| `unit_price` | `numeric(19,6) NOT NULL` | ≥ 0, ≤ 999 999 999.999999, at most 6 decimals. `CHECK (unit_price >= 0)`. Parsed from the user's string. |
| `currency` | `char(3) NOT NULL DEFAULT 'EUR'` | Only `EUR` accepted in Phase 1 |
| `kpd_code` | `char(6) NULL` | Digits only (`^\d{6}$`) after stripping dots and spaces, so `62.01.11` is stored as `620111`. Displayed as `62.01.11`. |
| `archived_at` | `timestamptz NULL` | |
| `created_at`, `updated_at` | `timestamptz NOT NULL` | |

Index: `(organization_id, lower(name))`. RLS as above.

### `audit_log`

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` PK | |
| `organization_id` | `text NOT NULL` | |
| `actor_user_id` | `text NOT NULL` | |
| `action` | `text NOT NULL` | e.g. `org.created`, `obrt_profile.updated`, `member.invited`, `member.role_changed`, `member.removed`, `customer.created`, `customer.updated`, `customer.archived`, `customer.restored`, `item.*` |
| `entity_type` | `text NOT NULL` | |
| `entity_id` | `text NOT NULL` | |
| `changed_fields` | `text[] NOT NULL DEFAULT '{}'` | Field **names** only, never values |
| `request_id` | `text NULL` | |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` | |

- Two further audit actions exist beyond the list above: `member.invitation_revoked` and `member.joined`.
- Append-only: a `BEFORE UPDATE OR DELETE` trigger raises an exception, and `pf_app` has no UPDATE or DELETE grant.
- RLS: SELECT and INSERT policies on `organization_id`.
- Index: `(organization_id, occurred_at DESC)`.

### Migrations

- Drizzle-generated migrations for the tables.
- One **custom** migration (`drizzle-kit generate --custom`) for: `ENABLE` and `FORCE ROW LEVEL SECURITY` plus the policies on the four tenant tables, grants to `pf_app`, the audit trigger function `forbid_mutation()`, and the CHECK constraints above if Drizzle cannot express them.

## Routes, server actions, API

**Shared contract for every server action** (`src/server/actions/result.ts`):

- Input is validated with zod. All strings are trimmed. Money and decimal fields arrive as **strings** and are parsed with `src/lib/money/parse.ts`, never `Number()` or `parseFloat`.
- Returns `ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; fieldErrors?: Record<string, string> }`. Messages are in Croatian. No stack traces or SQL errors reach the client.
- Authorization goes first:
  - `requireUser()` for user-level actions;
  - `requireOrgContext(orgSlug, { roles })` for org actions. It loads the session through `auth.api.getSession({ headers })`, resolves the org by slug, and **loads the membership from the DB**. If the user is not a member it throws `notFound()`; if the role is not allowed it returns `{ ok:false, message:'Nemate ovlasti za ovu radnju.' }`.
- Writes run inside `withTenant(ctx, tx => …)`, which runs `set_config('app.org_id', ctx.orgId, true)`, and record an audit row in the same transaction.
- After success: `revalidatePath` for the affected list or detail page.

**Role matrix (proposed; open question 1)**

| Capability | owner | accountant | member |
|---|---|---|---|
| View and edit obrt profile | edit | view | view |
| Invite, remove, change role of members | yes | no | no |
| Customers and items: create, edit, archive, restore | yes | yes | yes |

### Route handlers

- `GET|POST /api/auth/[...all]`: Better Auth via `toNextJsHandler(auth)`. Its built-in rate limiting is enabled with database storage.
- No other route handlers in Phase 1.

### Better Auth configuration (`src/server/auth/auth.ts`)

Verify the option names against the Better Auth docs at implementation time.

- Drizzle adapter on the `pf_app` pool.
- `emailAndPassword`: enabled, `requireEmailVerification: true`, `minPasswordLength: 10`, `sendResetPassword` uses the email transport.
- `emailVerification`: `sendOnSignUp: true`, `autoSignInAfterVerification: true`.
- `session.expiresIn` 7 days, `updateAge` 1 day. Secure cookies in production. `trustedOrigins` from env.
- Plugins, in this order:
  - `organization({ creatorRole: 'owner', sendInvitationEmail, roles via createAccessControl: owner, accountant, member })`;
  - `twoFactor({ issuer: env.APP_NAME })`;
  - `nextCookies()`, which must be last.

### Server actions

| Action | File | Input | Output | Auth |
|---|---|---|---|---|
| `createOrganizationWithProfile` | `src/server/org/actions.ts` | obrt profile fields + `declareNotInVat: true` | `{ orgSlug }` | `requireUser()` |
| `updateObrtProfile` | same | `orgSlug`, profile fields (OIB **not** editable once set; see edge cases) | `{}` | owner |
| `inviteMember` | same | `orgSlug`, `email`, `role ∈ {accountant, member}` | `{ invitationId }` | owner |
| `revokeInvitation` | same | `orgSlug`, `invitationId` | `{}` | owner |
| `changeMemberRole` | same | `orgSlug`, `memberId`, `role` | `{}` | owner; cannot demote the last owner |
| `removeMember` | same | `orgSlug`, `memberId` | `{}` | owner; cannot remove the last owner |
| `acceptInvitation` | same | `invitationId` | `{ orgSlug }` | `requireUser()`; the invitation email must equal the user's verified email |
| `createCustomer` / `updateCustomer` | `src/server/customers/actions.ts` | `orgSlug`, customer fields (+ `customerId` for update) | `{ customerId }` | any member |
| `archiveCustomer` / `restoreCustomer` | same | `orgSlug`, `customerId` | `{}` | any member |
| `createItem` / `updateItem` | `src/server/items/actions.ts` | `orgSlug`, item fields with `unitPrice` as a string | `{ itemId }` | any member |
| `archiveItem` / `restoreItem` | same | `orgSlug`, `itemId` | `{}` | any member |

**`createOrganizationWithProfile` flow:**

1. Validate the input.
2. Reject if `oib` already exists in `obrt_profiles` with "Obrt s tim OIB-om već je registriran. Zatražite pozivnicu od vlasnika." This check runs under the owner-less `pf_app` role, so it uses a `SECURITY DEFINER` function `oib_is_registered(oib)` that returns only a boolean. RLS would otherwise hide other tenants' rows.
3. Create the organization with `auth.api.createOrganization` (name = trade name, slug from `src/server/org/slug.ts`).
4. Insert the profile and the `org.created` audit row in `withTenant`.

If step 4 fails, the org exists without a profile. The org layout detects a missing profile and redirects to `/app/novi-obrt?org=…` to finish, so no compensation logic is needed. Steps 3 and 4 cannot share a transaction because Better Auth owns step 3.

**Slug generation:** lower-case the trade name, transliterate č ć → c, đ → d, š → s, ž → z, replace non-alphanumerics with `-`, trim to 40 chars, and append `-` plus 4 random base36 characters if the slug is taken.

### Queries (server-only; called from server components)

All run through `withTenant` after `requireOrgContext`:

- `listCustomers(ctx, { q?, archived?: boolean, page })`: 50 per page ordered by `lower(name)`. In the UI, "Prikaži arhivirane" shows active and archived customers together. `q` matches `name`, `oib` or `email` case-insensitively with `ILIKE`, after escaping `%`, `_` and `\`.
- `getCustomer(ctx, id)`: `notFound()` if missing.
- `listItems` and `getItem`: same pattern.
- `getObrtProfile(ctx)`, `listMembers(ctx)`, `listPendingInvitations(ctx)`.
- `listMyOrganizations(userId)`: from `member` joined to `organization`.

### `proxy.ts`

UX only. It redirects requests to `/app/**` without a session cookie to `/prijava?next=…`, using Better Auth's cookie helper. Real checks always happen in layouts and actions.

## UI

All text is in Croatian. `<html lang="hr">`. Forms use native `<form action={…}>` with `useActionState`:

- pending state: the button shows "Spremanje…" and is disabled;
- field errors under each field;
- a success toast (sonner).

Amount and decimal inputs are text inputs with `inputMode="decimal"`. They show what the user typed, and on blur they reformat to hr-HR **for display only**. The submitted value is always the user's raw string.

### Auth pages (route group `src/app/(auth)/`)

| Path | Purpose | States |
|---|---|---|
| `/registracija` | Email, password (twice), acceptance of terms (checkbox, links are placeholders) | Error for an email already in use: generic message to prevent enumeration ("Ako adresa nije zauzeta, poslali smo vam e-poruku za potvrdu.") |
| `/potvrda-emaila` | "Provjerite e-poštu" + resend button (rate-limited) | Expired or invalid token message |
| `/prijava` | Email + password; redirects to `/dvofaktorska` when `twoFactorRedirect` | Wrong credentials: generic message; unverified email: resend link |
| `/dvofaktorska` | TOTP code or backup code, "Vjeruj ovom uređaju 30 dana" | Wrong code |
| `/zaboravljena-lozinka`, `/nova-lozinka` | Reset flow | Generic confirmation; expired token |
| `/pozivnica/[invitationId]` | Shows the obrt name and role; Accept / Decline. Not signed in → sign in or register first, then come back. | Expired, revoked, or email mismatch ("Pozivnica je poslana na drugu adresu.") |

### App pages (`src/app/app/`)

| Path | Purpose | Empty / loading / error |
|---|---|---|
| `/app` | 0 orgs → redirect to `/app/novi-obrt`; 1 org → redirect to it; more → org picker list | Loading skeleton |
| `/app/novi-obrt` | Onboarding form: obrt details. A checkbox "Nisam u sustavu PDV-a i oporezujem se paušalno" is required. If the user says they are in VAT: "Aplikacija je trenutno namijenjena paušalistima izvan sustava PDV-a." | Field errors; duplicate OIB message |
| `/app/profil/sigurnost` | Change password; enable or disable TOTP (QR + manual key, verify code, show backup codes once); list and revoke sessions | |
| `/app/[org]` | Dashboard placeholder: obrt name, "Prvi koraci" checklist (Podaci o obrtu ✓, Dodajte kupca, Dodajte artikl, Uključite dvofaktorsku prijavu) | |
| `/app/[org]/kupci` | Table: Naziv, Vrsta (Fizička osoba / Poslovni subjekt), OIB / PDV ID, Mjesto, E-pošta. Search box, "Prikaži arhivirane" toggle, pagination, "Novi kupac" button. | Empty: "Još nemate kupaca." + button. Empty search: "Nema rezultata za „…“." Loading: table skeleton. |
| `/app/[org]/kupci/novi`, `/app/[org]/kupci/[customerId]` | Customer form; the kind toggle shows or hides OIB, PDV ID and address requirements; the country select defaults to Hrvatska. Edit page has Arhiviraj / Vrati. | Archived banner; not found → 404 |
| `/app/[org]/artikli` (+ `/novi`, `/[itemId]`) | Table: Naziv, Jedinica, Cijena (hr-HR, e.g. `1.234,50 €`; unit prices with more decimals shown in full, e.g. `0,125 €`), KPD. Form fields: name, description, unit, unit price, KPD. | Same patterns as customers |
| `/app/[org]/postavke/obrt` | Profile form; OIB read-only with a hint ("OIB se ne može mijenjati. Za drugi obrt otvorite novi."). Non-owners see it read-only. | |
| `/app/[org]/postavke/clanovi` | Members (email, role, joined); pending invitations; invite form (owner only) | Empty pending list text |

**Shared:**

- `src/app/app/[org]/layout.tsx` runs `requireOrgContext` and renders the shell: sidebar with Nadzorna ploča, Kupci, Artikli, Postavke; an org switcher; a user menu.
- `loading.tsx` in `app/[org]`.
- `error.tsx`: "Nešto je pošlo po zlu." + "Pokušaj ponovno". Logs `digest` only.
- `not-found.tsx`: "Stranica ne postoji ili nemate pristup."

URL paths are Croatian because users see them (open question 5). Code identifiers stay in English.

## Files

### Create (config and tooling)

- `package.json`
  - scripts: `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`), `lint` (`eslint .`), `test` (`vitest run`), `test:watch`, `e2e` (`playwright test`), `db:generate`, `db:migrate`, `db:studio`, `check` (typecheck + lint + test + build)
  - `engines.node` `>=24`
- `.nvmrc` (24), `.gitignore` (includes `.env*.local`), `.env.example`
- `tsconfig.json` (strict, `noUncheckedIndexedAccess: true`, path alias `@/*` → `src/*`)
- `next.config.ts`
  - `output: 'standalone'`
  - security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal, CSP in **Report-Only**, HSTS in production
  - `serverExternalPackages` only if a dependency needs it
- `eslint.config.mjs`
  - `eslint-config-next`
  - `no-restricted-globals: parseFloat`
  - `no-restricted-properties` for `Number.parseFloat` and `.toFixed`
  - `no-restricted-syntax` banning `Number(` calls inside `src/lib/money/**` and `src/server/**/actions.ts`
- `.prettierrc.json`, `postcss.config.mjs`, `components.json` (shadcn), `src/app/globals.css`
- `vitest.config.ts`
  - projects: `unit` (node env, `src/**/*.test.ts`) and `integration` (`tests/integration/**`, globalSetup migrates `pf_test`)
- `playwright.config.ts` (webServer runs `scripts/e2e/stack.ts`, baseURL `http://localhost:3100`)
- `scripts/e2e/stack.ts`: self-contained e2e stack in one process: throwaway PostgreSQL 17 (temp dir, free port) with roles, `pf_e2e` database and migrations; the mail catcher on SMTP 1125 / API 1180; `next dev` on port 3100 with its own build directory (`NEXT_DIST_DIR=.next-e2e`). Every env var is passed explicitly, so `.env.local` is never used and a running `npm run dev` / `db` / `mail` does not clash. `PF_E2E=1` enables the test-only hooks in `src/server/test-hooks.ts` (never active in production); `next-env.d.ts` is restored on shutdown.
- `docker-compose.yml`
  - `postgres:17` with `scripts/db/init.sql` mounted to create `pf_owner`, `pf_app`, `pf_dev` and `pf_test`
  - `axllent/mailpit` (SMTP 1025, UI 8025)
- `scripts/db/init.sql`
- `drizzle.config.ts` (uses `DATABASE_MIGRATION_URL`, out `drizzle/`)
- `drizzle/` (generated migrations) + `drizzle/XXXX_rls_grants_audit.sql` (custom)

### Create (server)

- `src/server/env.ts`: zod-validated env (`DATABASE_URL`, `DATABASE_MIGRATION_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_NAME`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER?`, `SMTP_PASS?`, `MAIL_FROM`, `TRUSTED_ORIGINS`)
- `src/server/log.ts`: JSON logger over `console` with key-based redaction (`oib`, `iban`, `email`, `password`, `token`, `name`, `phone`, `secret`, `cookie`, `authorization`) and no request bodies
- `src/server/db/client.ts`: `pg` Pool with `pf_app`, Drizzle instance
- `src/server/db/tenant.ts`: `withTenant(ctx, fn)`
- `src/server/db/schema/auth.ts` (generated), `obrt-profiles.ts`, `customers.ts`, `items.ts`, `audit-log.ts`, `index.ts`
- `src/server/auth/auth.ts`: Better Auth instance
- `src/server/auth/permissions.ts`: access-control statements and roles
- `src/server/auth/context.ts`: `requireUser`, `requireOrgContext`, `OrgContext` type
- `src/server/email/transport.ts`: nodemailer SMTP transport and `sendMail`
- `src/server/email/templates/verify-email.ts`, `reset-password.ts`, `invitation.ts`: Croatian plain-text + simple HTML
- `src/server/audit/record.ts`: `recordAudit(tx, ctx, {action, entityType, entityId, changedFields})`
- `src/server/actions/result.ts`
- `src/server/org/schemas.ts`, `actions.ts`, `queries.ts`, `slug.ts`
- `src/server/customers/schemas.ts`, `actions.ts`, `queries.ts`
- `src/server/items/schemas.ts`, `actions.ts`, `queries.ts`, `units.ts`
- Every file under `src/server/` starts with `import 'server-only'`.

### Create (shared libraries; pure, no server-only)

- `src/lib/money/decimal.ts`: a `Decimal` clone with `precision: 40`, `rounding: Decimal.ROUND_HALF_UP`. Comment: "Rounding rule: roadmap §4.5."
- `src/lib/money/parse.ts`: `parseAmountToCents(input, opts)` and `parseDecimal(input, { maxScale, allowNegative })`. Rules are under Money & date edge cases.
- `src/lib/money/format.ts`: `formatCents(cents, currency)` and `formatDecimal(str, currency)` via `Intl.NumberFormat('hr-HR')`
- `src/lib/money/line-total.ts`: `lineTotalCents({ quantity, unitPrice, discountPercent? })`, for Phase 2 but built and tested now
- `src/lib/money/allocate.ts`: `allocateCents(total, weights)` with the largest-remainder method
- `src/lib/money/index.ts`
- `src/lib/dates/zagreb.ts`:
  - `CalendarDate` branded type (`YYYY-MM-DD`)
  - `toZagrebCalendarDate(instant: Date)`, `zagrebYear(instant)`, `formatZagrebDateTime(instant)` (e.g. `09.10.2026. 14:05`), `formatCalendarDate(d)` (`09.10.2026.`), `todayInZagreb()`
  - built on `Intl.DateTimeFormat` with `timeZone: 'Europe/Zagreb'`; no date library
- `src/lib/validation/oib.ts`: `isValidOib` (ISO 7064 MOD 11,10), comment citing the standard
- `src/lib/validation/iban.ts`: `normalizeIban`, `isValidIban` (ISO 13616 mod-97, country lengths for at least HR=21 and the EU/EEA set), `formatIban` (groups of 4)
- `src/lib/validation/kpd.ts`: `normalizeKpd`, `formatKpd`
- `src/lib/auth-client.ts`: `createAuthClient` with the organization and twoFactor client plugins

### Create (app and components)

- `src/proxy.ts`
- `src/app/layout.tsx`, `src/app/page.tsx` (redirects to `/app`)
- `src/app/api/auth/[...all]/route.ts`
- `src/app/(auth)/layout.tsx`, `registracija/page.tsx`, `potvrda-emaila/page.tsx`, `prijava/page.tsx`, `dvofaktorska/page.tsx`, `zaboravljena-lozinka/page.tsx`, `nova-lozinka/page.tsx`
- `src/app/pozivnica/[invitationId]/page.tsx`
- `src/app/app/page.tsx`, `src/app/app/novi-obrt/page.tsx`, `src/app/app/profil/sigurnost/page.tsx`
- `src/app/app/[org]/layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`
- `src/app/app/[org]/kupci/page.tsx`, `kupci/novi/page.tsx`, `kupci/[customerId]/page.tsx`
- `src/app/app/[org]/artikli/page.tsx`, `artikli/novi/page.tsx`, `artikli/[itemId]/page.tsx`
- `src/app/app/[org]/postavke/obrt/page.tsx`, `postavke/clanovi/page.tsx`
- `src/components/ui/*`: shadcn-generated button, input, label, textarea, select, checkbox, card, table, badge, dialog, dropdown-menu, skeleton, separator, sonner
- `src/components/app-shell/sidebar.tsx`, `org-switcher.tsx`, `user-menu.tsx`
- `src/components/common/empty-state.tsx`, `field-error.tsx`, `decimal-input.tsx`, `pagination.tsx`, `submit-button.tsx`
- `src/components/org/obrt-profile-form.tsx`, `members-table.tsx`, `invite-form.tsx`
- `src/components/customers/customer-form.tsx`, `customer-table.tsx`
- `src/components/items/item-form.tsx`, `item-table.tsx`
- `src/components/auth/*` (sign-in, sign-up, 2FA forms)

### Create (tests)

`test-writer` owns the test contents. These paths are reserved:

- `tests/helpers/db.ts`: migrate, truncate, and create users, orgs and members directly
- `tests/helpers/fake.ts`: **generated** fake OIBs (10 random digits + computed check digit) and fake HR IBANs with valid checksums; never real data
- `tests/integration/*.test.ts`, `tests/e2e/*.spec.ts`
- `src/lib/**/*.test.ts` colocated unit tests

### Modify

- `CLAUDE.md`: **not by this plan.** After the user approves, the main session records the approved decisions under Open decisions, and the developer fills the **Commands** section in step 1: `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run e2e`, `npm run build`.

### Dependencies (each justified)

| Package | Why |
|---|---|
| `next` (≥ 16.3, patched for CVE-2026-64649), `react`, `react-dom` | Stack |
| `typescript`, `@types/node`, `@types/react`, `@types/react-dom` (dev) | Stack |
| `drizzle-orm`, `drizzle-kit` (dev), `pg`, `@types/pg` (dev) | Approved ORM, migrations and driver |
| `better-auth` | Approved auth: sessions, orgs, invitations, TOTP 2FA |
| `zod` | Validating every server action input |
| `decimal.js` | Exact decimal math for quantity × price (required by `CLAUDE.md`) |
| `nodemailer`, `@types/nodemailer` (dev) | SMTP delivery for verification and invitation email (Mailpit locally, SES SMTP later) |
| `server-only` | Fails the build if server modules are imported into client code |
| `tailwindcss`, `@tailwindcss/postcss`, plus shadcn's own deps (`radix-ui` primitives, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`) | Approved UI kit |
| `vitest`, `@playwright/test` (dev) | Approved test stack |
| `eslint`, `eslint-config-next`, `prettier` (dev) | Lint and format |

No other dependencies. In particular, no date library: `Intl` covers Zagreb conversion.

Implementation notes: shadcn init generated `src/lib/utils.ts` on the `cn` package (shadcn-ui/cn, no dependencies) instead of `clsx` + `tailwind-merge`; reviewer accepted it. TypeScript is pinned to 6.0.x and ESLint to 9.x because of `eslint-config-next` peer ranges.

## Build sequence

Each step ends green on `npm run typecheck && npm run lint && npm run test`.

1. **Scaffold.**
   - Next.js 16 app in `src/` with TS strict, ESLint rules above, Prettier, Tailwind v4 and shadcn init, Vitest and Playwright configs, `package.json` scripts, `.nvmrc`, `.env.example`.
   - Fill the CLAUDE.md Commands.
   - *Verify:* `npm run dev` shows a Croatian placeholder page; `npm run build` passes.
2. **Local infrastructure and DB plumbing.**
   - `docker-compose.yml` (Postgres 17 + Mailpit), `scripts/db/init.sql` (roles and databases), `src/server/env.ts`, `src/server/log.ts`, `src/server/db/client.ts`, `drizzle.config.ts`.
   - *Verify:* `docker compose up -d`; `npm run db:migrate` runs as `pf_owner`; a scratch script connects as `pf_app` and runs `select 1`.
3. **Pure libraries.**
   - `src/lib/money/*`, `src/lib/dates/zagreb.ts`, `src/lib/validation/*`, with unit tests for every case under Money & date edge cases.
   - *Verify:* unit tests pass; ESLint rejects a planted `parseFloat` in a scratch file.
4. **Authentication.**
   - Better Auth config, generated schema, migration, route handler, auth client, email transport and templates, auth pages, `proxy.ts`, `/app/profil/sigurnost`.
   - *Verify by hand:* register → Mailpit → verify → sign in → enable TOTP → sign out → sign in with TOTP → reset password.
5. **Tenant layer.**
   - Schema for `obrt_profiles`, `customers`, `items`, `audit_log`; the custom migration (RLS, FORCE, policies, grants, `forbid_mutation` trigger, CHECKs, the `oib_is_registered` SECURITY DEFINER function); `withTenant`, `requireOrgContext`, `recordAudit`, `ActionResult`.
   - *Verify:* integration tests:
     - as `pf_app` without `app.org_id`, tenant tables return 0 rows;
     - with org A set, inserting a row for org B fails;
     - `UPDATE audit_log` and `DELETE audit_log` fail.
6. **Onboarding, profile and members.**
   - `/app`, `/app/novi-obrt`, `/app/[org]` layout and shell, `postavke/obrt`, `postavke/clanovi`, the invitation page and all org actions.
   - *Verify:* create an obrt; invite a second user through Mailpit; accept; the role matrix is enforced; the last owner cannot be removed.
7. **Customers.**
   - Schemas, actions, queries, list, form and edit pages, archive and restore.
   - *Verify:* integration tests for validation rules and the duplicate-OIB message; manual UI check of all states.
8. **Items.**
   - Same pattern, plus `units.ts`, the `decimal-input` component and KPD normalization.
   - *Verify:* `0,125` saves as `0.125000` and displays as `0,125 €`; `1.234` is rejected with the ambiguity message.
9. **Shell polish and states.**
   - Dashboard checklist; `loading`/`error`/`not-found`; org switcher; security headers.
   - *Verify:* every page has its empty, loading and error state; response headers present.
10. **E2E and check script.**
    - Playwright specs (see Test plan) and `npm run check`.
    - *Verify:* `npm run e2e` passes against the local stack.
11. **(Only if hosting is approved) Container and staging.**
    - `Dockerfile` (multi-stage, Node 24, `standalone`, non-root user), `.dockerignore`, and a short `docs/runbooks/staging.md`.
    - *Verify:* the image runs locally against docker-compose Postgres.

## Money & date edge cases

### `parseAmountToCents(input, { allowNegative = false, max = 99_999_999_999 })`

For amounts in minor units. Not used by Phase 1 UI, but built and tested now.

| Input | Result |
|---|---|
| `"12,50"` | `1250` |
| `"1.234,56"` | `123456` |
| `"1234,56"` | `123456` |
| `"1 234,56"` (space, NBSP U+00A0 or narrow NBSP U+202F) | `123456` |
| `"12.5"` / `"12.50"` | `1250`. A single dot followed by 1–2 digits, with no comma, is a decimal point, because people paste English-format numbers. |
| `"1.234"` | **error, ambiguous**: "Nejasan iznos. Upišite npr. 1.234,00 ili 1,234." The pattern `^[1-9]\d{0,2}\.\d{3}$` with no comma is rejected. |
| `"1.234.567"` | `123456700`. Multiple dot groups of 3 can only be thousands separators. |
| `"1.234.567,89"` | `123456789` |
| `"0,125"` | **error**: "Najviše 2 decimale." |
| `"0"` / `"0,00"` | `0` |
| `"0,01"` | `1` |
| `"-5,00"` | error unless `allowNegative`; with it, `-500` |
| `"−5,00"` (U+2212 minus) | treated as `-` |
| `"+5"` | `500` |
| `"1,234.56"` | **error**: "Za decimale koristite zarez." A dot after a comma is not allowed. |
| `"12,5,0"`, `"1..2"`, `"1.23.4"`, `",5"`, `"5,"` | **error** (malformed). A leading or trailing separator is never accepted. |
| `""`, `"   "` | error "Obavezno polje." (or `null` when the field is optional) |
| `"abc"`, `"12€"`, `"€12"`, `"1e3"`, `"0x10"`, `"١٢"` (non-ASCII digits) | error |
| `"999.999.999,99"` | `99999999999` |
| `"1.000.000.000,00"` | error, above `max` |

### `parseDecimal(input, { maxScale = 6, allowNegative = false })`

Used for unit prices and quantities. It applies the same separator rules but allows up to `maxScale` decimals, and returns a normalized decimal string such as `"0.125"`.

- `"0,125"` → `"0.125"`.
- `"0.125"` → `"0.125"`. A leading `0.` cannot be a thousands group, so it is not ambiguous.
- `"1,1234567"` → error "Najviše 6 decimala."
- `"1.234"` → ambiguity error, as above.

### `lineTotalCents` (rounding rule, roadmap §4.5)

| Case | Result |
|---|---|
| 1 × 0.125 | 0.125 → **13** cents |
| 3 × 0.333333 | 0.999999 → **100** |
| 1.5 × 33.33 | 49.995 → **5000** |
| −1.5 × 33.33 | −49.995 → **−5000** (half away from zero) |
| 1 × 0.05 with 10% discount | 0.045 → **5** |
| 0 × 99.99 | **0** |
| 2 × 0 | **0** |
| 1 × 0.004999 | **0** |
| 1 × 0.005 | **1** |
| 1 × 999999999.999999 | **100000000000** cents (1.000.000.000,00): within range, returned |
| 999999999 × 999999999.999999 | exceeds `Number.MAX_SAFE_INTEGER` cents → **explicit error** "Iznos stavke je prevelik." (checked on the Decimal before converting to a number) |

The function is rounded **once**: intermediate products are never rounded. Discount is a percentage between 0 and 100 inclusive, with at most 2 decimals. Above 100 is an error.

### `allocateCents(total, weights)`

| Case | Result |
|---|---|
| 1000, [1,1,1] | [334, 333, 333] |
| 1, [1,1,1] | [1, 0, 0] |
| 0, [1,2] | [0, 0] |
| −1000, [1,1,1] | [−334, −333, −333] (remainder goes away from zero, earliest first) |
| 100, seven equal weights | [15, 15, 14, 14, 14, 14, 14] |
| 1000, [0,1] | [0, 1000] |
| 1000, [] or all-zero weights | error |

The sum always equals `total`.

### Dates (`Europe/Zagreb`)

| Instant (UTC) | Zagreb date / year |
|---|---|
| `2026-12-31T22:30:00Z` (23:30 local) | `2026-12-31`, year **2026** |
| `2026-12-31T23:30:00Z` (00:30 local, 1 Jan) | `2027-01-01`, year **2027** |
| `2026-07-01T21:59:59Z` (summer, UTC+2) | `2026-07-01` |
| `2026-07-01T22:00:00Z` | `2026-07-02` |

- DST start: `2026-03-29T00:59:59Z` → local 01:59:59 CET; `2026-03-29T01:00:00Z` → local 03:00:00 CEST.
- DST end: `2026-10-25T00:30:00Z` and `2026-10-25T01:30:00Z` both show local `02:30`. Formatting must not throw, and the dates are the same.
- Leap day: `2028-02-29` is a valid `CalendarDate`; `2027-02-29` is rejected by `CalendarDate` parsing.

### Identifiers

- **OIB:**
  - check-digit failure → error;
  - 10 or 12 digits → error;
  - letters → error;
  - spaces are stripped before validation;
  - the generated fake OIBs in tests must validate.
- **OIB immutability:** the profile OIB cannot be changed after onboarding, because changing it would mean a different taxpayer. `updateObrtProfile` ignores or rejects `oib`.
- **IBAN:** lower case and spaces are accepted and normalized; a wrong checksum is rejected; an HR IBAN with 20 or 22 characters is rejected. A non-HR valid IBAN is accepted with a visible warning, pending open question 4.
- **KPD:** `62.01.11`, `620111` and ` 62 01 11 ` → `620111`; `6201` → error.

### Currency

Only `EUR` is accepted for items in Phase 1. Any other code is rejected server-side even if posted.

## Test plan

`test-writer` must cover at least the following.

**Unit (`src/lib/**`)**

1. Every row in the parse, `lineTotalCents`, `allocateCents` and date tables above, as table-driven tests.
2. `formatCents`: `0` → `0,00 €`, `1` → `0,01 €`, `123456` → `1.234,56 €`, `-500` → `−5,00 €` (U+2212, the CLDR minus sign for `hr`). Assert on `Intl` output after normalizing NBSP to a space. Machine formats (HUB3, UBL, F1) never use `formatCents`.
3. `formatDecimal("0.125","EUR")` → `0,125 €`; `formatDecimal("12.000000","EUR")` → `12,00 €`. Trailing zeros are trimmed to at least 2 decimals.
4. A round trip: `parseDecimal(formatDecimal(x))` equals `x` for a sample of values. The UI never does this in production; the test guards that display formatting stays parseable.
5. OIB, IBAN and KPD validators: the cases above, plus 1,000 generated valid fake OIBs and IBANs.

**Integration (real PostgreSQL, `pf_test`, as `pf_app`)**

6. **RLS:**
   - no context → 0 rows from each tenant table;
   - context org A → only A's rows;
   - `INSERT` with `organization_id = B` under context A → error;
   - `UPDATE … SET organization_id = B` → error.
7. **Action-level tenancy:** for each customer and item action, a user who is a member of A only, calling with `orgSlug` of B, gets `notFound` and no rows change. The same applies when the user's session "active organization" is B but the membership row was deleted. Membership is re-read from the DB.
8. **Role matrix:** an accountant and a member cannot invite, remove or change roles, or edit the profile; the owner can. The last owner cannot be demoted or removed.
9. **Audit:**
   - every mutating action writes exactly one audit row with the right action and `changed_fields` names;
   - no row contains OIB, email or name values (assert `changed_fields` has names only, and no column holds them);
   - `UPDATE` and `DELETE` on `audit_log` raise.
10. **Customers:**
    - HR business without OIB → field error;
    - person without OIB → OK;
    - foreign business with `vat_id` `"de 123456789"` → stored `DE123456789`;
    - duplicate active OIB in the same org → "Kupac s tim OIB-om već postoji.";
    - the same OIB in a different org → OK;
    - archived duplicate → creating a new one with the same OIB is OK;
    - search escapes `%` and `_` (searching `"50%"` does not match everything);
    - archived customers are hidden by default and shown with the toggle.
11. **Items:**
    - `unitPrice "0,125"` stored as numeric `0.125`;
    - `"1.234"` rejected;
    - a negative price rejected;
    - a 7-decimal price rejected;
    - `currency "USD"` posted directly → rejected;
    - KPD normalized.
12. **Onboarding:**
    - duplicate obrt OIB across orgs → the friendly message, and **no information leaks** about which org holds it;
    - `in_vat_system=true` → rejected;
    - an org without a profile redirects to finish onboarding.
13. **Invitations:**
    - accepting with a different verified email → rejected;
    - an expired or revoked invitation → rejected;
    - accepting makes the user a member with the invited role.
14. **Auth:**
    - unverified users cannot reach `/app/**`;
    - TOTP-enabled sign-in requires a code;
    - backup codes work once;
    - the reset-password token works once.

**E2E (Playwright, local mail catcher API for emails)**

Runs against the self-contained stack from `scripts/e2e/stack.ts` (app 3100, SMTP 1125, mail API 1180, `PF_E2E=1` test hook), started by Playwright's `webServer`; `npm run e2e` needs nothing else running.

15. Register → verify via the Mailpit link → onboarding with a generated fake OIB/IBAN → dashboard checklist → create a customer (person) and a business with OIB → create an item with price `0,125` → the list shows `0,125 €`.
16. User B (separate org) opens user A's `/app/{slugA}/kupci` and `/app/{slugA}/kupci/{id}` → 404 page; no customer name from A is present in the HTML.
17. Owner invites an accountant → the accountant accepts → sees customers and cannot open the "Pozovi člana" form (the control is absent and the action is refused).
18. Empty states visible for a fresh org on Kupci and Artikli; the error boundary renders when a query throws (use a test-only flag in `NODE_ENV=test`).

**Fixtures:** only generated fake data (`tests/helpers/fake.ts`). No real OIBs, IBANs, names or email domains other than `example.com` / `example.test`.

## Open questions

1. **Roles:** is owner / accountant / member with the matrix above right? Should an accountant be able to edit the obrt profile?
2. **2FA:** optional in Phase 1 (recommended), with Phase 3 requiring it for owners before certificate upload. Or mandatory from day one?
3. **Sign-up:** open registration, or invite-only (allow-list) during development and beta?
4. **Non-HR IBAN** for the obrt's account (e.g. foreign neobanks): allow with a warning (recommended), block, or allow silently? HUB 3A is for national payments, so a non-HR IBAN may not work in the HUB3 barcode (to verify in Phase 2).
5. **Croatian URL slugs** (`/app/[org]/kupci`, `/artikli`, `/postavke`): OK?
6. **Hosting** must be approved before step 11; until then Phase 1 runs locally only.
7. **Customer OIB for persons:** do not collect by default (data minimization; recommended), or offer an optional field? Note that F1 messages do not need a consumer's OIB.
8. **One obrt per OIB:** a second user trying to register an obrt with an existing OIB is told to ask the owner for an invitation. Is that the desired behaviour?
9. **Zajednički obrt** (co-owners) is not modelled; a single `owner_full_name`. Is that acceptable for the MVP?
