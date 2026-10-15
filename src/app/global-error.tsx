'use client'

import { useEffect } from 'react'

// Last resort when the root layout itself fails; it replaces the layout, so it renders <html>.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // The digest only: it correlates with the server log, while the message may hold personal data.
    console.error('global error', { digest: error.digest })
  }, [error.digest])

  return (
    <html lang="hr">
      <body>
        <main role="alert" style={{ maxWidth: '28rem', margin: '2.5rem auto', padding: '0 1rem' }}>
          <h1>Nešto je pošlo po zlu.</h1>
          <button onClick={() => retry()}>Pokušaj ponovno</button>
        </main>
      </body>
    </html>
  )
}
