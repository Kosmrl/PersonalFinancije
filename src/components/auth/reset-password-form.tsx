'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FieldError, FormError } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from './errors'

const MIN_PASSWORD_LENGTH = 10

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')
    const next: Record<string, string> = {}
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Lozinka mora imati najmanje ${MIN_PASSWORD_LENGTH} znakova.`
    }
    if (confirm !== password) next.confirm = 'Lozinke se ne podudaraju.'
    setErrors(next)
    setError(null)
    if (Object.keys(next).length > 0) return

    setPending(true)
    const { error: apiError } = await authClient.resetPassword({ newPassword: password, token })
    setPending(false)
    if (apiError) {
      setError(authErrorMessage(apiError))
      return
    }
    router.push('/prijava?lozinka=promijenjena')
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Nova lozinka</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!errors.password}
        />
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
      <SubmitButton pending={pending}>Spremi novu lozinku</SubmitButton>
    </form>
  )
}
