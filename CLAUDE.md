# PersonalFinancije

Cloud invoicing and bookkeeping for Croatian **paušalni obrtnici** (flat-rate sole traders), built as a competitor to e-računi. It is meant to become a real product with paying customers, so legal compliance, security and data retention are requirements, not extras.

PersonalFinancije is the working name; the product name is an open decision.

## MVP scope

- **Invoices & quotes**: customers, products/services, PDF output with HUB3 payment barcode, email sending, paid/unpaid tracking
- **B2C fiscalization** with the Tax Administration (Porezna uprava): ZKI/JIR, FINA certificate
- **B2B eRačun** under Fiskalizacija 2.0: sending and receiving structured e-invoices (EN 16931) through an information intermediary
- **Bookkeeping basics**: KPR (knjiga prometa), bank statement import, matching payments to invoices, reports

Phasing and the regulatory requirements are in the roadmap plan in `docs/plans/`.

## Stack

- Next.js (App Router) + React + TypeScript (strict mode)
- The UI is in Croatian. Code, comments, identifiers and commit messages are in English.
- Everything else is listed under **Open decisions** below. `architect` settles these and updates this file.

## Commands

- dev: `npm run dev`
- typecheck: `npm run typecheck`
- lint: `npm run lint`
- test: `npm run test`
- e2e: `npm run e2e`
- build: `npm run build`
- local PostgreSQL (foreground, Ctrl+C stops it): `npm run db`
- local mail catcher (SMTP 1025, web UI and API on 1080): `npm run mail`
- migrations: `npm run db:generate`, `npm run db:migrate`, `npm run db:studio`

## Agent team

This project uses a team of subagents (`.claude/agents/`), each on a model matched to its job. The main session is the orchestrator: it routes work to agents and talks to the user. Agents don't spawn other agents.

| Agent | Model | Use for |
|---|---|---|
| `architect` | Opus, high effort | Planning features and researching regulations: data model, routes, file layout, build order, edge cases. Writes `docs/plans/`. Writes no app code. |
| `developer` | Sonnet | Implementing approved plans and fixing reported bugs. |
| `test-writer` | Sonnet | Writing and running tests, especially money, numbering, date and compliance edge cases. Reports app bugs instead of fixing them. |
| `reviewer` | Opus, high effort | Read-only review for money correctness, compliance, security and privacy, and bugs. |
| `scout` | Haiku | Quick lookups, "where is X", running checks and summarizing failures, docs lookups. Read-only. |

**Workflow:** `architect` → user approves → `developer` → `test-writer` → `reviewer` → fixes → done.

- `/feature <description>` runs the whole workflow.
- `/check` runs typecheck, lint, tests and build through `scout`.

**Routing rules**

- Trivial edits (a typo, copy text, a one-line fix): the main session does them directly, with no agents.
- Lookups and failing checks: `scout`.
- Anything that touches the database schema, auth, money calculations, invoice numbering, fiscalization, e-invoices or certificates goes to `architect` first and `reviewer` after. No exceptions.

## Money & invoicing conventions (non-negotiable)

- **Stored amounts are integers in minor units (cents)**, with an ISO 4217 currency code; the default is EUR. Never use floating-point math on money. Never add amounts in different currencies without an explicit conversion.
- **Quantities and unit prices may be more precise than cents** (1.5 hours, 0.125 EUR per unit). Multiply them with a decimal library, never JS floats, and round each line total to cents exactly once, using the rounding rule documented in the roadmap plan.
- **Parse user input from the string**, never with `parseFloat` or `Number()`. Accept Croatian formats such as `12,50` and `1.234,56`.
- **Invoice amounts are positive.** Corrections (storno, credit notes) are separate documents with negative amounts that reference the original invoice.
- **Issued invoices are immutable.** Once an invoice is issued (numbered, fiscalized or sent), it is never edited or deleted, only corrected by a new document. Drafts are editable.
- **Invoice numbers are sequential, with no gaps or duplicates**, within each numbering sequence (business premises, device, year), and stay correct under concurrent issuing.
- **Formatting happens only at the display edge**, via `Intl.NumberFormat` with locale `hr-HR`. Formatted strings never flow back into stored values or calculations.
- **Time:** legal timestamps (invoice issue time, fiscalization) are stored in UTC and shown in `Europe/Zagreb`. Business dates (delivery date, due date, KPR entry date) are calendar dates (`YYYY-MM-DD`).
- **Tenancy:** data belongs to an organization (the obrt), not to a single user. Every query is scoped to the current organization, and every server action and route handler checks that the signed-in user belongs to it.
- **Retention:** invoices, fiscalization records and e-invoice documents are kept for the legally required period documented in the roadmap plan, including after a customer cancels their subscription.
- **Certificates:** FINA certificates and private keys are encrypted at rest, decrypted only in the server process that signs, and never logged or sent to the browser. App secrets live only in `.env.local` and are never committed.
- **Privacy (GDPR):** an obrtnik's OIB, name and address are personal data. Never log invoice contents, amounts, OIBs or certificate data alongside identity. Fixtures and tests use made-up data only.
- **Compliance code follows the official specifications.** Where code implements fiscalization, e-invoice XML or KPR rules, a comment names the specification and its version.

## Decisions

Details and reasoning are in `docs/plans/2026-10-09-product-roadmap.md` §4–5.

- **Database and ORM:** PostgreSQL 17 + Drizzle. Tenant tables use Row-Level Security plus an app-level membership check on every action.
- **Auth:** Better Auth: email + password, email verification, TOTP 2FA, organization plugin with roles owner / accountant / member.
- **Styling and UI kit:** Tailwind CSS v4 + shadcn/ui.
- **Test stack:** Vitest (unit tests, plus integration tests against real PostgreSQL) and Playwright (e2e).
- **Background jobs:** pg-boss on the same PostgreSQL.
- **PDF (Phase 2):** @react-pdf/renderer, with bwip-js for HUB3 and QR codes.
- **E-invoice exchange:** integrate with an existing information intermediary through an adapter; don't become one.
- **Rounding:** each line total is computed exactly with decimal.js and rounded once to cents with ROUND_HALF_UP (ties away from zero). The document total is the sum of line totals. Splits use the largest-remainder method.
- **Retention:** 11 years after the year of issue (pending confirmation by a tax advisor).
- **Local development database:** a project-local PostgreSQL 17 through the `embedded-postgres` npm package, with no Docker or system install. Integration tests start their own throwaway instance. Test emails go to a local npm-based mail catcher.

## Open decisions

- Product name
- Hosting provider (roadmap recommends AWS Frankfurt; Scaleway is the EU-owned alternative)
- Which intermediary (ePoslovanje or moj-eRačun, after commercial talks)
- Pricing and billing

## Plans

Feature plans live in `docs/plans/YYYY-MM-DD-<slug>.md` (see `docs/plans/README.md`). Read the relevant plan before changing a feature.
