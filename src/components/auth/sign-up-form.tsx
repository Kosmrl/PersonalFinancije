'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FieldError, FormError } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from './errors'

const MIN_PASSWORD_LENGTH = 10

export function SignUpForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')

    const next: Record<string, string> = {}
    if (!email) next.email = 'Obavezno polje.'
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Lozinka mora imati najmanje ${MIN_PASSWORD_LENGTH} znakova.`
    }
    if (confirm !== password) next.confirm = 'Lozinke se ne podudaraju.'
    if (!accepted) next.terms = 'Za nastavak morate prihvatiti uvjete korištenja.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0) return

    setPending(true)
    // Better Auth requires a display name; it is the part of the address before the @ until
    // the user profile has a name field.
    const { error } = await authClient.signUp.email({
      email,
      password,
      name: email.split('@')[0] ?? email,
      callbackURL: '/potvrda-emaila',
    })
    setPending(false)
    if (error) {
      setFormError(authErrorMessage(error))
      return
    }
    // The same outcome for a new and an existing address (anti-enumeration).
    router.push('/potvrda-emaila?poslano=1')
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-pošta</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!errors.email}
        />
        <FieldError message={errors.email} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Lozinka</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!errors.password}
        />
        <p className="text-muted-foreground text-sm">Najmanje {MIN_PASSWORD_LENGTH} znakova.</p>
        <FieldError message={errors.password} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Ponovite lozinku</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!errors.confirm}
        />
        <FieldError message={errors.confirm} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <Checkbox
            id="terms"
            checked={accepted}
            onCheckedChange={(value) => setAccepted(value === true)}
            aria-invalid={!!errors.terms}
          />
          <Label htmlFor="terms" className="leading-snug font-normal">
            Prihvaćam{' '}
            <Link href="#" className="underline">
              uvjete korištenja
            </Link>{' '}
            i{' '}
            <Link href="#" className="underline">
              pravila privatnosti
            </Link>
            .
          </Label>
        </div>
        <FieldError message={errors.terms} />
      </div>
      <SubmitButton pending={pending} pendingLabel="Registracija…">
        Registriraj se
      </SubmitButton>
    </form>
  )
}
