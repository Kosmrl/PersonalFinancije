'use client'

import { useState } from 'react'
import { FormError, FormNotice } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from './errors'

export function ForgotPasswordForm() {
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
    const { error: apiError } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/nova-lozinka',
    })
    setPending(false)
    if (apiError) {
      setError(authErrorMessage(apiError))
      return
    }
    setSent(true)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={error} />
      {sent ? (
        <FormNotice>
          Ako račun s tom adresom postoji, poslali smo vam poruku s poveznicom za novu lozinku.
        </FormNotice>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-pošta</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <SubmitButton pending={pending} pendingLabel="Slanje…">
        Pošalji poveznicu
      </SubmitButton>
    </form>
  )
}
