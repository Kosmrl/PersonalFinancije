import { twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// Browser-side Better Auth client. Same-origin, so no baseURL is needed.
export const authClient = createAuthClient({
  plugins: [twoFactorClient({ twoFactorPage: '/dvofaktorska' })],
})
