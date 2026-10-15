import 'server-only'

/**
 * Test-only hook for the Playwright e2e suite: makes a page throw so the error boundary can be
 * checked. Active only when scripts/e2e/stack.ts started the app (PF_E2E=1) and never in a
 * production build.
 */
export function throwForE2e(flag: string | string[] | undefined): void {
  if (process.env.NODE_ENV === 'production' || process.env.PF_E2E !== '1') return
  if (flag === '1') throw new Error('e2e forced query failure')
}
