import 'server-only'
import { z } from 'zod'
import { Decimal, parseDecimal } from '@/lib/money'
import { normalizeKpd } from '@/lib/validation/kpd'
import { UNIT_CODES } from './units'

// Input schemas for the item actions (plan: "items" table rules). Every string is trimmed;
// messages are Croatian and become field errors.
//
// The unit price arrives as the user's STRING and is parsed with parseDecimal (Croatian formats,
// at most 6 decimals, no floats). The result is a normalised decimal string ("0.125") that goes
// to the numeric(19,6) column as is. Only EUR is accepted in Phase 1.

export const ARCHIVED_MESSAGE = 'Artikl je arhiviran. Vratite ga prije uređivanja.'

const REQUIRED = 'Obavezno polje.'

// Control characters (incl. newlines and tabs) are refused in single-line fields; only the
// description may contain line breaks.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const NO_CONTROL = 'Unos sadrži nedozvoljene znakove.'
// Line breaks are allowed in the description, other control characters are not.
const NON_NEWLINE_CONTROL = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/

const MAX_UNIT_PRICE = new Decimal('999999999.999999')

const name = z
  .string({ error: REQUIRED })
  .trim()
  .min(1, REQUIRED)
  .max(200, 'Najviše 200 znakova.')
  .refine((value) => !CONTROL_CHARS.test(value), NO_CONTROL)

// Browsers submit textarea line breaks as CRLF; normalise to LF before the length check so a
// line break counts as one character.
const description = z
  .string()
  .transform((value) => value.replace(/\r\n/g, '\n'))
  .pipe(
    z
      .string()
      .trim()
      .max(1000, 'Najviše 1000 znakova.')
      .refine((value) => !NON_NEWLINE_CONTROL.test(value), NO_CONTROL),
  )
  .nullish()
  .transform((value) => (value ? value : null))

const unitPrice = z.string({ error: REQUIRED }).transform((value, ctx) => {
  const parsed = parseDecimal(value, { maxScale: 6, allowNegative: false })
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: parsed.error })
    return z.NEVER
  }
  if (new Decimal(parsed.value).gt(MAX_UNIT_PRICE)) {
    ctx.addIssue({ code: 'custom', message: 'Cijena je prevelika.' })
    return z.NEVER
  }
  return parsed.value
})

const kpdCode = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null
    const normalized = normalizeKpd(value)
    if (normalized === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'KPD šifra mora imati 6 znamenki, npr. 62.01.11.',
      })
      return z.NEVER
    }
    return normalized
  })

export const itemSchema = z.object({
  name,
  description,
  unitCode: z.enum(UNIT_CODES, { error: 'Odaberite jedinicu mjere.' }),
  unitPrice,
  // Not a form field: a posted value other than EUR is refused.
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .default('EUR')
    .refine((value) => value === 'EUR', 'Podržana je samo valuta EUR.'),
  kpdCode,
})

export type ItemInput = z.output<typeof itemSchema>

export const itemIdSchema = z.uuid({ error: 'Neispravan zahtjev.' })
