'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FormError } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from './errors'

export function TwoFactorForm() {
  const router = useRouter()
  const [useBackup, setUseBackup] = useState(false)
  const [trust, setTrust] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim()
    if (!code) {
      setError('Unesite kod.')
      return
    }
    setPending(true)
    setError(null)
    const { error: apiError } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: trust })
    if (apiError) {
      setPending(false)
      setError(authErrorMessage(apiError, 'Pogrešan kod. Pokušajte ponovno.'))
      return
    }
    router.replace('/app')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">{useBackup ? 'Pričuvni kod' : 'Kod iz aplikacije za provjeru'}</Label>
        <Input
          id="code"
          name="code"
          autoComplete="one-time-code"
          inputMode={useBackup ? 'text' : 'numeric'}
          // Remount when the mode changes so the previous entry does not carry over.
          key={useBackup ? 'backup' : 'totp'}
          autoFocus
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="trust"
          checked={trust}
          onCheckedChange={(value) => setTrust(value === true)}
        />
        <Label htmlFor="trust" className="font-normal">
          Vjeruj ovom uređaju 30 dana
        </Label>
      </div>
      <SubmitButton pending={pending} pendingLabel="Provjera…">
        Potvrdi
      </SubmitButton>
      <Button
        type="button"
        variant="link"
        onClick={() => {
          setUseBackup((value) => !value)
          setError(null)
        }}
      >
        {useBackup ? 'Koristi kod iz aplikacije' : 'Koristi pričuvni kod'}
      </Button>
    </form>
  )
}
