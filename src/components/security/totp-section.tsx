'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { authErrorMessage } from '@/components/auth/errors'
import { FormError, FormNotice } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

type Setup = { totpUri: string; secret: string; backupCodes: string[] }

// The manual key is the `secret` parameter of the otpauth:// URI. A QR code needs a rendering
// library that the plan does not list, so the key and the URI are shown instead.
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

// Only a wrong password is reported as such; anything else (rate limit, server error) is generic.
function passwordErrorMessage(error: { code?: string; status?: number } | null): string {
  return error?.code === 'INVALID_PASSWORD' ? 'Pogrešna lozinka.' : authErrorMessage(error)
}

export function TotpSection({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [codesShown, setCodesShown] = useState<string[] | null>(null)

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    if (!password) {
      setError('Unesite lozinku.')
      return
    }
    setPending(true)
    setError(null)
    const { data, error: apiError } = await authClient.twoFactor.enable({ password })
    setPending(false)
    if (apiError || !data || data.method !== 'totp') {
      setError(passwordErrorMessage(apiError))
      return
    }
    setSetup({
      totpUri: data.totpURI,
      secret: secretFromUri(data.totpURI),
      backupCodes: data.backupCodes,
    })
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim()
    if (!code) {
      setError('Unesite kod.')
      return
    }
    setPending(true)
    setError(null)
    const { error: apiError } = await authClient.twoFactor.verifyTotp({ code })
    setPending(false)
    if (apiError) {
      setError(authErrorMessage(apiError, 'Pogrešan kod. Pokušajte ponovno.'))
      return
    }
    // Backup codes are shown exactly once, here, after the TOTP is confirmed.
    setCodesShown(setup?.backupCodes ?? [])
    setSetup(null)
    toast.success('Dvofaktorska prijava je uključena.')
    router.refresh()
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    if (!password) {
      setError('Unesite lozinku.')
      return
    }
    setPending(true)
    setError(null)
    const { error: apiError } = await authClient.twoFactor.disable({ password })
    setPending(false)
    if (apiError) {
      setError(passwordErrorMessage(apiError))
      return
    }
    toast.success('Dvofaktorska prijava je isključena.')
    router.refresh()
  }

  if (codesShown) {
    return (
      <div className="flex max-w-sm flex-col gap-3">
        <FormNotice>
          Spremite ove pričuvne kodove na sigurno mjesto. Svaki vrijedi jednom i više se neće
          prikazati.
        </FormNotice>
        <ul className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-3 font-mono text-sm">
          {codesShown.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <button type="button" className="text-sm underline" onClick={() => setCodesShown(null)}>
          Spremio sam kodove
        </button>
      </div>
    )
  }

  if (setup) {
    return (
      <form onSubmit={confirm} noValidate className="flex max-w-sm flex-col gap-4">
        <FormError message={error} />
        <p className="text-sm">
          U aplikaciji za provjeru (npr. Google Authenticator) dodajte novi račun ručnim unosom
          ključa, a zatim upišite prikazani šesteroznamenkasti kod.
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Ključ za ručni unos</span>
          <code className="bg-muted rounded-lg px-3 py-2 font-mono text-sm break-all">
            {setup.secret}
          </code>
          <a href={setup.totpUri} className="text-muted-foreground text-sm underline">
            Otvori u aplikaciji za provjeru
          </a>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="totp-code">Kod iz aplikacije</Label>
          <Input
            id="totp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </div>
        <SubmitButton pending={pending} pendingLabel="Provjera…">
          Potvrdi i uključi
        </SubmitButton>
      </form>
    )
  }

  return (
    <div className="flex max-w-sm flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm">Stanje:</span>
        <Badge variant={enabled ? 'default' : 'secondary'}>
          {enabled ? 'Uključeno' : 'Isključeno'}
        </Badge>
      </div>
      <form onSubmit={enabled ? disable : start} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="totp-password">Lozinka (potvrda)</Label>
          <Input
            id="totp-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <SubmitButton
          pending={pending}
          pendingLabel="Obrada…"
          variant={enabled ? 'destructive' : 'default'}
        >
          {enabled ? 'Isključi dvofaktorsku prijavu' : 'Uključi dvofaktorsku prijavu'}
        </SubmitButton>
      </form>
    </div>
  )
}
