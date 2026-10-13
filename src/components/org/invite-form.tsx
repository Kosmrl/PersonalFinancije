'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FormError } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { TextField } from '@/components/common/text-field'
import { failureOf, useActionForm } from '@/components/common/use-action-form'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FieldError } from '@/components/common/field-error'
import { inviteMember } from '@/server/org/actions'

export function InviteForm({ orgSlug }: { orgSlug: string }) {
  const [role, setRole] = useState('accountant')
  const [state, formAction, pending] = useActionForm<{ invitationId: string }>(
    (values) => inviteMember({ orgSlug, email: values.email, role }),
    () => toast.success('Pozivnica je poslana.'),
  )
  const failure = failureOf(state)
  const errors = failure?.fieldErrors ?? {}
  // Cleared after success, kept after a failure so the address can be corrected.
  const email = failure ? (state.values.email ?? '') : ''

  return (
    <form
      action={formAction}
      key={state.result?.ok ? `sent-${JSON.stringify(state.result.data)}` : 'form'}
      noValidate
      className="flex flex-col gap-4"
    >
      {failure && !failure.fieldErrors ? <FormError message={failure.message} /> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <TextField
          name="email"
          type="email"
          label="E-pošta osobe"
          defaultValue={email}
          error={errors.email}
          autoComplete="off"
          required
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="field-role">Uloga</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="field-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="accountant">Knjigovođa</SelectItem>
              <SelectItem value="member">Član</SelectItem>
            </SelectContent>
          </Select>
          <FieldError message={errors.role} />
        </div>
      </div>
      <SubmitButton pending={pending} pendingLabel="Slanje…" className="self-start">
        Pozovi člana
      </SubmitButton>
    </form>
  )
}
