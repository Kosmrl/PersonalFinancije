import { defineConfig, devices } from '@playwright/test'

// `npm run e2e` starts its own stack through scripts/e2e/stack.ts: a throwaway PostgreSQL, the
// mail catcher and the app (next dev), all on ports that do not clash with `npm run dev`.
// Override with E2E_APP_PORT, E2E_SMTP_PORT, E2E_MAIL_HTTP_PORT.
const appPort = process.env.E2E_APP_PORT ?? '3100'
const baseURL = `http://localhost:${appPort}`

export default defineConfig({
  testDir: 'tests/e2e',
  // Every test registers its own users, but they all share one app, database and mail catcher
  // (and one rate-limit bucket), so run them one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    locale: 'hr-HR',
    timezoneId: 'Europe/Zagreb',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/e2e/stack.ts',
    url: baseURL,
    // The stack owns a throwaway database; never attach to something already listening.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      E2E_APP_PORT: appPort,
      ...(process.env.E2E_SMTP_PORT ? { E2E_SMTP_PORT: process.env.E2E_SMTP_PORT } : {}),
      ...(process.env.E2E_MAIL_HTTP_PORT
        ? { E2E_MAIL_HTTP_PORT: process.env.E2E_MAIL_HTTP_PORT }
        : {}),
    },
  },
})
