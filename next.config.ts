import type { NextConfig } from 'next'
import { buildSecurityHeaders } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  output: 'standalone',
  // The e2e stack (scripts/e2e/stack.ts) builds into its own directory so it never fights a
  // running `npm run dev` over the .next lock.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // Do not auto-generate AGENTS.md; CLAUDE.md is the single source of project rules.
  agentRules: false,
  async headers() {
    return [
      { source: '/:path*', headers: buildSecurityHeaders(process.env.NODE_ENV === 'production') },
    ]
  },
}

export default nextConfig
