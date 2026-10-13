'use client'

import { useState } from 'react'
import { FormError, FormNotice } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from './errors'

// Always shows the same confirmation, whether or not the address has an account to verify.
export function ResendVerificationForm({ defaultEmail = '' }: { defaultEmail?: string }) {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    if (!email) {
      setError('Unesite adresu e-pošte.')
      return
    }
    setPending(true)
    setError(null)
    const { error: apiError } = await authClient.sendVerificationEmail({
      email,
      callbackURL: '/potvrda-emaila',
    })
    setPending(false)
    if (apiError) {
      setError(authErrorMessage(apiError))
      return
    }
    setSent(true)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <FormError message={error} />
      {sent ? (
        <FormNotice>
          Ako postoji neaktivirani račun s tom adresom, poslali smo novu poruku.
        </FormNotice>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="resend-email">E-pošta</Label>
        <Input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={defaultEmail}
          required
        />
      </div>
      <SubmitButton pending={pending} pendingLabel="Slanje…" variant="outline">
        Pošalji poruku ponovno
      </SubmitButton>
    </form>
  )
}
