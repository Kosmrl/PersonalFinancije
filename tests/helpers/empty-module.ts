// Stand-in for the `server-only` package in Vitest (see vitest.config.ts). The real package
// throws when imported outside a React Server Component build, which would stop tests from
// importing src/server modules.
export {}
