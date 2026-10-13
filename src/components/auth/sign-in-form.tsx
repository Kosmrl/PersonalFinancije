'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FormError } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage, safeNextPath } from './errors'
import { ResendVerificationForm } from './resend-verification-form'

export function SignInForm({ next }: { next?: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    if (!email || !password) {
      setError('Unesite e-poštu i lozinku.')
      return
    }
    setPending(true)
    setError(null)
    setUnverifiedEmail(null)
    const destination = safeNextPath(next)
    const { data, error: apiError } = await authClient.signIn.email({ email, password })
    if (!apiError) {
      // An account with TOTP is sent to /dvofaktorska by the two-factor client plugin. Without
      // it, a full navigation picks up the session cookie that was just set.
      if (!(data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        window.location.assign(destination)
      }
      return
    }
    setPending(false)
    if (apiError.code === 'EMAIL_NOT_VERIFIED') {
      setUnverifiedEmail(email)
      setError('E-pošta još nije potvrđena. Provjerite poštu ili zatražite novu poruku.')
      return
    }
    setError(authErrorMessage(apiError, 'Pogrešna e-pošta ili lozinka.'))
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">E-pošta</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Lozinka</Label>
            <Link href="/zaboravljena-lozinka" className="text-muted-foreground text-sm underline">
              Zaboravljena lozinka?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <SubmitButton pending={pending} pendingLabel="Prijava…">
          Prijavi se
        </SubmitButton>
      </form>
      {unverifiedEmail ? <ResendVerificationForm defaultEmail={unverifiedEmail} /> : null}
    </div>
  )
}
