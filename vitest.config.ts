import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside a Server Component build; tests get an empty module.
      'server-only': fileURLToPath(new URL('./tests/helpers/empty-module.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          // Not Europe/Zagreb, so code that wrongly uses local Date getters fails. Set through
          // the worker environment, so it applies before any test file is loaded.
          env: { TZ: 'UTC' },
        },
      },
      {
        // Real PostgreSQL 17: global-setup starts a throwaway embedded instance, applies
        // scripts/db/init.sql, migrates pf_test as pf_owner, and removes it afterwards.
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
