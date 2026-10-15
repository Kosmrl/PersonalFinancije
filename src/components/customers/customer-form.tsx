'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { FieldError, FormError, FormNotice } from '@/components/common/field-error'
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
import { Textarea } from '@/components/ui/textarea'
import { COUNTRIES } from '@/lib/countries'
import { createCustomer, updateCustomer } from '@/server/customers/actions'

export type CustomerFormValues = {
  kind: 'person' | 'business'
  name: string
  oib: string
  vatId: string
  street: string
  postalCode: string
  city: string
  countryCode: string
  email: string
  note: string
}

export const EMPTY_CUSTOMER: CustomerFormValues = {
  kind: 'person',
  name: '',
  oib: '',
  vatId: '',
  street: '',
  postalCode: '',
  city: '',
  countryCode: 'HR',
  email: '',
  note: '',
}

type Props = { orgSlug: string; initial: CustomerFormValues } & (
  { mode: 'create' } | { mode: 'edit'; customerId: string; archived: boolean }
)

const KINDS = [
  { value: 'person', label: 'Fizička osoba' },
  { value: 'business', label: 'Poslovni subjekt' },
] as const

export function CustomerForm(props: Props) {
  const router = useRouter()
  const readOnly = props.mode === 'edit' && props.archived

  const [state, formAction, pending] = useActionForm<{ customerId: string }>(
    async (values) => {
      const fields = { ...values, orgSlug: props.orgSlug }
      if (props.mode === 'create') return createCustomer(fields)
      return updateCustomer({ ...fields, customerId: props.customerId })
    },
    () => {
      toast.success(props.mode === 'create' ? 'Kupac je dodan.' : 'Podaci su spremljeni.')
      if (props.mode === 'create') router.push(`/app/${props.orgSlug}/kupci`)
      else router.refresh()
    },
  )

  const failure = failureOf(state)
  const errors = failure?.fieldErrors ?? {}
  // After a failed submit show what was typed; otherwise the stored values.
  const value = (name: keyof CustomerFormValues): string =>
    failure ? (state.values[name] ?? '') : props.initial[name]
  const formKey = failure ? JSON.stringify(state.values) : 'initial'

  // The kind and country drive which fields are shown, so they are controlled. A submit that
  // failed remounts the form (key) with the typed values, so the state follows the key.
  return (
    <CustomerFields
      key={formKey}
      formAction={formAction}
      pending={pending}
      readOnly={readOnly}
      message={failure && !Object.values(errors).includes(failure.message) ? failure.message : null}
      errors={errors}
      value={value}
      submitLabel={props.mode === 'create' ? 'Dodaj kupca' : 'Spremi promjene'}
    />
  )
}

function CustomerFields({
  formAction,
  pending,
  readOnly,
  message,
  errors,
  value,
  submitLabel,
}: {
  formAction: (formData: FormData) => void
  pending: boolean
  readOnly: boolean
  message: string | null
  errors: Record<string, string>
  value: (name: keyof CustomerFormValues) => string
  submitLabel: string
}) {
  const [kind, setKind] = useState(value('kind') === 'business' ? 'business' : 'person')
  const [country, setCountry] = useState(value('countryCode') || 'HR')
  const isBusiness = kind === 'business'
  const isCroatian = country === 'HR'
  const addressSuffix = isBusiness ? '' : ' (neobavezno)'

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <FormError message={message} />
      {readOnly ? <FormNotice>Kupac je arhiviran i ne može se uređivati.</FormNotice> : null}
      <fieldset disabled={readOnly || pending} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Vrsta kupca">
          <Label>Vrsta kupca</Label>
          <div className="flex flex-wrap gap-4">
            {KINDS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={kind === option.value}
                  onChange={() => setKind(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <FieldError message={errors.kind} />
        </div>
        <TextField
          name="name"
          label={isBusiness ? 'Naziv' : 'Ime i prezime'}
          defaultValue={value('name')}
          error={errors.name}
          autoComplete="off"
          required
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="field-countryCode">Država</Label>
          <Select name="countryCode" value={country} onValueChange={setCountry}>
            <SelectTrigger id="field-countryCode" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.countryCode} />
        </div>
        {isBusiness ? (
          <TextField
            name="oib"
            label={isCroatian ? 'OIB' : 'OIB (neobavezno)'}
            inputMode="numeric"
            defaultValue={value('oib')}
            error={errors.oib}
            autoComplete="off"
            required={isCroatian}
          />
        ) : null}
        {isBusiness && !isCroatian ? (
          <TextField
            name="vatId"
            label="PDV ID (neobavezno)"
            defaultValue={value('vatId')}
            error={errors.vatId}
            placeholder="DE123456789"
            autoComplete="off"
            spellCheck={false}
          />
        ) : null}
        <TextField
          name="street"
          label={`Ulica i kućni broj${addressSuffix}`}
          defaultValue={value('street')}
          error={errors.street}
          autoComplete="off"
          required={isBusiness}
        />
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <TextField
            name="postalCode"
            label={`Poštanski broj${addressSuffix}`}
            inputMode={isCroatian ? 'numeric' : 'text'}
            defaultValue={value('postalCode')}
            error={errors.postalCode}
            autoComplete="off"
            required={isBusiness}
          />
          <TextField
            name="city"
            label={`Mjesto${addressSuffix}`}
            defaultValue={value('city')}
            error={errors.city}
            autoComplete="off"
            required={isBusiness}
          />
        </div>
        <TextField
          name="email"
          label="E-pošta (neobavezno)"
          type="email"
          defaultValue={value('email')}
          error={errors.email}
          autoComplete="off"
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="field-note">Interna napomena (neobavezno)</Label>
          <Textarea
            id="field-note"
            name="note"
            defaultValue={value('note')}
            aria-invalid={errors.note ? true : undefined}
            rows={3}
          />
          <FieldError message={errors.note} />
        </div>
      </fieldset>
      {readOnly ? null : (
        <SubmitButton pending={pending} className="self-start">
          {submitLabel}
        </SubmitButton>
      )}
    </form>
  )
}
