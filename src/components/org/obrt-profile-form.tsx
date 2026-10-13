'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { FieldError, FormError, FormNotice } from '@/components/common/field-error'
import { SubmitButton } from '@/components/common/submit-button'
import { TextField } from '@/components/common/text-field'
import { failureOf, useActionForm } from '@/components/common/use-action-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ibanCountryCode } from '@/lib/validation/iban'
import { createOrganizationWithProfile, updateObrtProfile } from '@/server/org/actions'

export type ObrtProfileValues = {
  tradeName: string
  ownerFullName: string
  oib: string
  street: string
  postalCode: string
  city: string
  iban: string
  email: string
  phone: string
  website: string
  defaultInvoiceNote: string
}

const NON_HR_IBAN = 'Ovaj IBAN nije hrvatski. HUB3 barkod za plaćanje možda neće raditi.'
const NOT_IN_VAT = 'Aplikacija je trenutno namijenjena paušalistima izvan sustava PDV-a.'

type Props =
  | {
      mode: 'create'
      initial: ObrtProfileValues
      /** Slug of an organization that exists without a profile (finishing onboarding). */
      existingOrgSlug?: string
    }
  | { mode: 'edit'; initial: ObrtProfileValues; orgSlug: string; readOnly: boolean }

export function ObrtProfileForm(props: Props) {
  const router = useRouter()
  const readOnly = props.mode === 'edit' && props.readOnly
  const [vat, setVat] = useState(false)
  const [vatTouched, setVatTouched] = useState(false)

  const [state, formAction, pending] = useActionForm<{ orgSlug?: string; nonHrIban: boolean }>(
    async (values) => {
      if (props.mode === 'create') {
        return createOrganizationWithProfile({
          ...values,
          existingOrgSlug: props.existingOrgSlug,
          declareNotInVat: values.declareNotInVat === 'on',
        })
      }
      return updateObrtProfile({ ...values, orgSlug: props.orgSlug })
    },
    (data) => {
      toast.success(props.mode === 'create' ? 'Obrt je postavljen.' : 'Podaci su spremljeni.')
      if (data.nonHrIban) toast.warning(NON_HR_IBAN)
      if (props.mode === 'create' && data.orgSlug) router.push(`/app/${data.orgSlug}`)
    },
  )

  const failure = failureOf(state)
  const errors = failure?.fieldErrors ?? {}
  // After a failed submit show what was typed; otherwise the stored values.
  const value = (name: keyof ObrtProfileValues) =>
    failure ? (state.values[name] ?? '') : props.initial[name]
  const formKey = failure ? JSON.stringify(state.values) : 'initial'
  const [ibanInput, setIbanInput] = useState(props.initial.iban)
  const country = ibanCountryCode(ibanInput)
  const showIbanWarning =
    country !== null && country !== 'HR' && ibanInput.replace(/\s/g, '').length >= 15

  return (
    <form action={formAction} key={formKey} noValidate className="flex flex-col gap-4">
      {failure && failure.message !== errors.oib ? <FormError message={failure.message} /> : null}
      {readOnly ? <FormNotice>Podatke o obrtu može mijenjati samo vlasnik.</FormNotice> : null}
      <fieldset disabled={readOnly || pending} className="flex flex-col gap-4">
        <TextField
          name="tradeName"
          label="Naziv obrta"
          defaultValue={value('tradeName')}
          error={errors.tradeName}
          autoComplete="organization"
          required
        />
        <TextField
          name="ownerFullName"
          label="Ime i prezime vlasnika"
          defaultValue={value('ownerFullName')}
          error={errors.ownerFullName}
          autoComplete="name"
          required
        />
        {props.mode === 'create' ? (
          <TextField
            name="oib"
            label="OIB"
            inputMode="numeric"
            defaultValue={value('oib')}
            error={errors.oib}
            required
          />
        ) : (
          <TextField
            name="oibDisplay"
            label="OIB"
            defaultValue={props.initial.oib}
            readOnly
            hint="OIB se ne može mijenjati. Za drugi obrt otvorite novi."
          />
        )}
        <TextField
          name="street"
          label="Ulica i kućni broj"
          defaultValue={value('street')}
          error={errors.street}
          autoComplete="street-address"
          required
        />
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <TextField
            name="postalCode"
            label="Poštanski broj"
            inputMode="numeric"
            defaultValue={value('postalCode')}
            error={errors.postalCode}
            autoComplete="postal-code"
            required
          />
          <TextField
            name="city"
            label="Mjesto"
            defaultValue={value('city')}
            error={errors.city}
            autoComplete="address-level2"
            required
          />
        </div>
        <input type="hidden" name="countryCode" value="HR" />
        <TextField
          name="iban"
          label="IBAN poslovnog računa"
          defaultValue={value('iban')}
          error={errors.iban}
          onChange={(event) => setIbanInput(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
          required
          hint={showIbanWarning ? <span role="status">{NON_HR_IBAN}</span> : undefined}
        />
        <TextField
          name="email"
          label="E-pošta obrta (prikazuje se na računima)"
          type="email"
          defaultValue={value('email')}
          error={errors.email}
          autoComplete="email"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="phone"
            label="Telefon (neobavezno)"
            type="tel"
            defaultValue={value('phone')}
            error={errors.phone}
            autoComplete="tel"
          />
          <TextField
            name="website"
            label="Web stranica (neobavezno)"
            defaultValue={value('website')}
            error={errors.website}
            placeholder="https://"
            autoComplete="url"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="field-defaultInvoiceNote">Zadana napomena na računu</Label>
          <Textarea
            id="field-defaultInvoiceNote"
            name="defaultInvoiceNote"
            defaultValue={value('defaultInvoiceNote')}
            aria-invalid={errors.defaultInvoiceNote ? true : undefined}
            rows={3}
          />
          <FieldError message={errors.defaultInvoiceNote} />
        </div>
        {props.mode === 'create' ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="field-declareNotInVat"
                name="declareNotInVat"
                checked={vat}
                onCheckedChange={(checked) => {
                  setVat(checked === true)
                  setVatTouched(true)
                }}
                aria-invalid={errors.declareNotInVat ? true : undefined}
              />
              <Label htmlFor="field-declareNotInVat" className="leading-snug">
                Nisam u sustavu PDV-a i oporezujem se paušalno
              </Label>
            </div>
            {!vat && (vatTouched || errors.declareNotInVat) ? (
              <FieldError message={errors.declareNotInVat ?? NOT_IN_VAT} />
            ) : null}
          </div>
        ) : null}
      </fieldset>
      {readOnly ? null : (
        <SubmitButton pending={pending} className="self-start">
          {props.mode === 'create' ? 'Postavi obrt' : 'Spremi promjene'}
        </SubmitButton>
      )}
    </form>
  )
}
