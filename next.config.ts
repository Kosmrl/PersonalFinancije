import type { NextConfig } from 'next'
import { buildSecurityHeaders } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  output: 'standalone',
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
