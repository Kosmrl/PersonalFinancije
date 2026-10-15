'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function OrgError({
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
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Nešto je pošlo po zlu.</h1>
      <Button onClick={() => retry()}>Pokušaj ponovno</Button>
    </div>
  )
}
