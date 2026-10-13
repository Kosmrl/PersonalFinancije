import { defineConfig } from 'drizzle-kit'

// Migrations run as the schema owner (pf_owner), never as the runtime role pf_app.
// The npm scripts (db:generate, db:migrate, db:studio) load .env.local and pass
// --conditions=react-server so the `import 'server-only'` in src/server/db/schema/*
// resolves to a no-op while drizzle-kit loads them.
const url = process.env.DATABASE_MIGRATION_URL
if (!url) {
  throw new Error('DATABASE_MIGRATION_URL is not set. Copy .env.example to .env.local.')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
})
