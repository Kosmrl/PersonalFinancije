'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { authErrorMessage } from '@/components/auth/errors'
import { FieldError, FormError } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

const MIN_PASSWORD_LENGTH = 10

export function ChangePasswordForm() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const current = String(form.get('current') ?? '')
    const password = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')
    const next: Record<string, string> = {}
    if (!current) next.current = 'Obavezno polje.'
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Lozinka mora imati najmanje ${MIN_PASSWORD_LENGTH} znakova.`
    }
    if (confirm !== password) next.confirm = 'Lozinke se ne podudaraju.'
    setErrors(next)
    setError(null)
    if (Object.keys(next).length > 0) return

    setPending(true)
    const { error: apiError } = await authClient.changePassword({
      currentPassword: current,
      newPassword: password,
      revokeOtherSessions: true,
    })
    setPending(false)
    if (apiError) {
      setError(authErrorMessage(apiError))
      return
    }
    formElement.reset()
    toast.success('Lozinka je promijenjena. Ostale sesije su odjavljene.')
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <FormError message={error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="current">Trenutna lozinka</Label>
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.current}
        />
        <FieldError message={errors.current} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">Nova lozinka</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
        />
        <FieldError message={errors.password} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm-password">Ponovite novu lozinku</Label>
        <Input
          id="confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirm}
        />
        <FieldError message={errors.confirm} />
      </div>
      <SubmitButton pending={pending}>Promijeni lozinku</SubmitButton>
    </form>
  )
}
