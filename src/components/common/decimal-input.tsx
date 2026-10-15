'use client'

import { useState } from 'react'
import { FieldError } from '@/components/common/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDecimalPlain, parseDecimal } from '@/lib/money'

type Props = {
  name: string
  label: string
  defaultValue?: string
  error?: string
  hint?: React.ReactNode
  /** Shown after the input, e.g. the currency. */
  suffix?: string
  maxScale?: number
  required?: boolean
}

/**
 * Text input for amounts and quantities (`inputMode="decimal"`). While the user types, and as
 * long as the text does not parse, the field shows exactly what was typed. On blur a valid value
 * is shown in hr-HR form (`1234,5` -> `1.234,50`), for DISPLAY ONLY: the submitted value is
 * always the user's raw string, carried by a hidden input of the same name, and the server
 * parses it (src/lib/money/parse.ts). Nothing is converted to a number here.
 */
export function DecimalInput({
  name,
  label,
  defaultValue = '',
  error,
  hint,
  suffix,
  maxScale = 6,
  required,
}: Props) {
  const id = `field-${name}`
  const [raw, setRaw] = useState(defaultValue)
  const [editing, setEditing] = useState(false)

  const parsed = parseDecimal(raw, { maxScale })
  const shown = !editing && parsed.ok ? formatDecimalPlain(parsed.value) : raw

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="hidden" name={name} value={raw} />
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          required={required}
          value={shown}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(event) => setRaw(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className="w-full sm:w-56"
        />
        {suffix ? <span className="text-muted-foreground text-sm">{suffix}</span> : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}
