import 'server-only'

// Tables arrive with later build-sequence steps: Better Auth tables in step 4 (auth.ts),
// tenant tables in step 5 (obrt-profiles.ts, customers.ts, items.ts, audit-log.ts).
// Re-export each schema module here so drizzle-kit and the Drizzle client see one schema.
export {}
