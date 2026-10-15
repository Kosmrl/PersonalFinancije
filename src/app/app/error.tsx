'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// Catches errors thrown by app/[org]/layout.tsx and the pages outside [org] (an error.tsx does not
// catch errors from the layout of its own segment).
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // The digest only: it correlates with the server log, while the message may hold personal data.
    console.error('app error', { digest: error.digest })
  }, [error.digest])

  return (
    <main
      role="alert"
      className="mx-auto flex w-full max-w-md flex-col items-start gap-3 px-4 py-10"
    >
      <h1 className="text-xl font-semibold">Nešto je pošlo po zlu.</h1>
      <Button onClick={() => retry()}>Pokušaj ponovno</Button>
    </main>
  )
}
