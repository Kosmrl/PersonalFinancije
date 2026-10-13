'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FormError } from '@/components/common/field-error'
import { Button } from '@/components/ui/button'
import { acceptInvitation, declineInvitation } from '@/server/org/actions'

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function accept() {
    setError(null)
    startTransition(async () => {
      const result = await acceptInvitation({ invitationId })
      if (!result.ok) return setError(result.message)
      toast.success('Pozivnica je prihvaćena.')
      router.push(`/app/${result.data.orgSlug}`)
    })
  }

  function decline() {
    setError(null)
    startTransition(async () => {
      const result = await declineInvitation({ invitationId })
      if (!result.ok) return setError(result.message)
      toast.success('Pozivnica je odbijena.')
      router.push('/app')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={accept} disabled={pending}>
          {pending ? 'Spremanje…' : 'Prihvati'}
        </Button>
        <Button variant="outline" onClick={decline} disabled={pending}>
          Odbij
        </Button>
      </div>
    </div>
  )
}
