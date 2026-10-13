// Next.js calls register() once when the server starts. Validating the environment here makes a
// bad or missing configuration fail at boot, with a message naming the variable, instead of on
// the first request that touches the database.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // `next build` collects page data through the same hook but has no runtime secrets.
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  const { getAuthEnv } = await import('@/server/env')
  getAuthEnv()
}
