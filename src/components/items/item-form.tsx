'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { DecimalInput } from '@/components/common/decimal-input'
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
import { createItem, updateItem } from '@/server/items/actions'
import { UNITS } from '@/server/items/units'

export type ItemFormValues = {
  name: string
  description: string
  unitCode: string
  /** The user's text, e.g. "0,125" (prefilled with decimalToInputText when editing). */
  unitPrice: string
  /** Formatted for editing, e.g. "62.01.11". */
  kpdCode: string
}

export const EMPTY_ITEM: ItemFormValues = {
  name: '',
  description: '',
  unitCode: 'H87',
  unitPrice: '',
  kpdCode: '',
}

type Props = { orgSlug: string; initial: ItemFormValues } & (
  { mode: 'create' } | { mode: 'edit'; itemId: string; archived: boolean }
)

export function ItemForm(props: Props) {
  const router = useRouter()
  const readOnly = props.mode === 'edit' && props.archived

  const [state, formAction, pending] = useActionForm<{ itemId: string }>(
    async (values) => {
      const fields = { ...values, orgSlug: props.orgSlug }
      if (props.mode === 'create') return createItem(fields)
      return updateItem({ ...fields, itemId: props.itemId })
    },
    () => {
      toast.success(props.mode === 'create' ? 'Artikl je dodan.' : 'Podaci su spremljeni.')
      if (props.mode === 'create') router.push(`/app/${props.orgSlug}/artikli`)
      else router.refresh()
    },
  )

  const failure = failureOf(state)
  const errors = failure?.fieldErrors ?? {}
  // After a failed submit show what was typed; otherwise the stored values.
  const value = (name: keyof ItemFormValues): string =>
    failure ? (state.values[name] ?? '') : props.initial[name]
  // A failed submit remounts the fields (key) so the typed values come back as defaults.
  const formKey = failure ? JSON.stringify(state.values) : 'initial'
  const message =
    failure && !Object.values(errors).includes(failure.message) ? failure.message : null

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <FormError message={message} />
      {readOnly ? <FormNotice>Artikl je arhiviran i ne može se uređivati.</FormNotice> : null}
      <fieldset key={formKey} disabled={readOnly || pending} className="flex flex-col gap-4">
        <TextField
          name="name"
          label="Naziv"
          defaultValue={value('name')}
          error={errors.name}
          autoComplete="off"
          required
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="field-description">Opis (neobavezno)</Label>
          <Textarea
            id="field-description"
            name="description"
            defaultValue={value('description')}
            aria-invalid={errors.description ? true : undefined}
            rows={3}
            maxLength={1000}
          />
          <FieldError message={errors.description} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="field-unitCode">Jedinica mjere</Label>
          <Select name="unitCode" defaultValue={value('unitCode') || 'H87'}>
            <SelectTrigger id="field-unitCode" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((unit) => (
                <SelectItem key={unit.code} value={unit.code}>
                  {unit.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.unitCode} />
        </div>
        <DecimalInput
          name="unitPrice"
          label="Cijena po jedinici"
          defaultValue={value('unitPrice')}
          error={errors.unitPrice}
          suffix="€"
          hint="Decimalni zarez, npr. 12,50 ili 0,125; do 6 decimala."
          required
        />
        <TextField
          name="kpdCode"
          label="KPD šifra (neobavezno)"
          defaultValue={value('kpdCode')}
          error={errors.kpdCode}
          placeholder="62.01.11"
          hint="Šest znamenki, s točkama ili bez."
          autoComplete="off"
          spellCheck={false}
          className="sm:max-w-56"
        />
      </fieldset>
      {readOnly ? null : (
        <SubmitButton pending={pending} className="self-start">
          {props.mode === 'create' ? 'Dodaj artikl' : 'Spremi promjene'}
        </SubmitButton>
      )}
    </form>
  )
}
