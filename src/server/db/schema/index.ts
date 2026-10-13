import 'server-only'

// One schema for drizzle-kit and the Drizzle client: Better Auth tables (step 4), and the
// tenant tables (obrt-profiles.ts, customers.ts, items.ts, audit-log.ts) with step 5.
export * from './auth'
