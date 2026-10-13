// `npm run mail`: runs the local mail catcher in the foreground until Ctrl+C.
//   SMTP:      127.0.0.1:SMTP_PORT (default 1025)
//   Web UI and HTTP API: http://127.0.0.1:MAIL_HTTP_PORT (default 1080)

import { startMailCatcher } from './catcher.ts'

function port(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`Invalid ${name}: ${process.env[name]}`)
    process.exit(1)
  }
  return value
}

try {
  const catcher = await startMailCatcher({
    smtpPort: port('SMTP_PORT', 1025),
    httpPort: port('MAIL_HTTP_PORT', 1080),
  })

  console.log('Mail catcher is running. Press Ctrl+C to stop.')
  console.log(`  SMTP:    127.0.0.1:${catcher.smtpPort}`)
  console.log(`  Web UI:  http://127.0.0.1:${catcher.httpPort}/`)
  console.log(`  API:     http://127.0.0.1:${catcher.httpPort}/api/messages`)

  const stop = () => {
    void catcher.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('SIGBREAK', stop)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
