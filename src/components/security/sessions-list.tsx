'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export type SessionRow = {
  id: string
  token: string
  userAgent: string | null
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function revoke(row: SessionRow) {
    setPendingId(row.id)
    const { error } = await authClient.revokeSession({ token: row.token })
    setPendingId(null)
    if (error) {
      toast.error('Sesiju nije moguće odjaviti. Pokušajte ponovno.')
      return
    }
    toast.success('Sesija je odjavljena.')
    router.refresh()
  }

  async function revokeOthers() {
    setPendingId('others')
    const { error } = await authClient.revokeOtherSessions()
    setPendingId(null)
    if (error) {
      toast.error('Sesije nije moguće odjaviti. Pokušajte ponovno.')
      return
    }
    toast.success('Ostale sesije su odjavljene.')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-lg border">
        {sessions.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{row.userAgent ?? 'Nepoznat uređaj'}</p>
              <p className="text-muted-foreground">
                Prijava: {row.createdAt} · Zadnja aktivnost: {row.lastSeenAt}
              </p>
            </div>
            {row.current ? (
              <Badge>Ova sesija</Badge>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingId !== null}
                onClick={() => revoke(row)}
              >
                {pendingId === row.id ? 'Odjava…' : 'Odjavi'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={pendingId !== null}
          onClick={revokeOthers}
        >
          {pendingId === 'others' ? 'Odjava…' : 'Odjavi sve ostale sesije'}
        </Button>
      ) : null}
    </div>
  )
}
