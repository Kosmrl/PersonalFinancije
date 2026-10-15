import 'server-only'
import { z } from 'zod'
import { COUNTRY_CODES } from '@/lib/countries'
import { isValidOib, normalizeOib } from '@/lib/validation/oib'

// Input schemas for the customer actions (plan: "customers" table rules). Every string is
// trimmed; messages are Croatian and become field errors.
//
// Rules that depend on several fields live in one transform, so the result is already
// normalised for storage:
// - OIB: valid if present; required for a Croatian business; never collected for a person (a
//   posted value is dropped: data minimisation, plan open question 7).
// - VAT ID: only for a business outside Croatia, upper-cased, no spaces.
// - Address: street, postal code and city are all required for a business; for a person each
//   part is stored as given (the columns are nullable).

export const CUSTOMER_KINDS = ['person', 'business'] as const
export type CustomerKind = (typeof CUSTOMER_KINDS)[number]

export const OIB_EXISTS_MESSAGE = 'Kupac s tim OIB-om već postoji.'
export const ARCHIVED_MESSAGE = 'Kupac je arhiviran. Vratite ga prije uređivanja.'

const REQUIRED = 'Obavezno polje.'

// Control characters (incl. newlines and tabs) are refused in single-line fields; only the note
// may contain line breaks.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const NO_CONTROL = 'Unos sadrži nedozvoljene znakove.'
const singleLine = (value: string) => !CONTROL_CHARS.test(value)

const text = (max: number) =>
  z
    .string({ error: REQUIRED })
    .trim()
    .min(1, REQUIRED)
    .max(max, `Najviše ${max} znakova.`)
    .refine(singleLine, NO_CONTROL)

// Optional free text: absent or empty after trimming means "not given" (null).
const optionalText = (max: number, allowNewlines = false) =>
  z
    .string()
    .trim()
    .max(max, `Najviše ${max} znakova.`)
    .refine((value) => allowNewlines || singleLine(value), NO_CONTROL)
    .nullish()
    .transform((value) => (value ? value : null))

const optionalEmail = z
  .string()
  .trim()
  .max(254, 'Najviše 254 znaka.')
  .nullish()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || z.email().safeParse(value).success, {
    message: 'Unesite ispravnu adresu e-pošte.',
  })
  .transform((value) => (value === null ? null : value.toLowerCase()))

const VAT_ID = /^[A-Z]{2}[A-Z0-9]{2,13}$/

const customerFields = z.object({
  kind: z.enum(CUSTOMER_KINDS, { error: 'Odaberite vrstu kupca.' }),
  name: text(200),
  // Raw here; interpreted together with kind and country below.
  oib: z.string().nullish(),
  vatId: z.string().nullish(),
  street: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .default('HR')
    .refine((value) => COUNTRY_CODES.includes(value), 'Odaberite državu s popisa.'),
  email: optionalEmail,
  note: optionalText(1000, true),
})

export const customerSchema = customerFields.transform((input, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message })

  const isBusiness = input.kind === 'business'
  const isCroatian = input.countryCode === 'HR'

  let oib: string | null = null
  if (isBusiness) {
    const normalized = normalizeOib(input.oib ?? '')
    if (normalized.length > 0) {
      if (isValidOib(normalized)) oib = normalized
      else issue('oib', 'Neispravan OIB.')
    } else if (isCroatian) {
      issue('oib', 'OIB je obavezan za hrvatski poslovni subjekt.')
    }
  }

  let vatId: string | null = null
  if (isBusiness && !isCroatian) {
    // Spaces, dots and hyphens are formatting only ("DE 123.456-789").
    const normalized = (input.vatId ?? '').replace(/[\s.-]/g, '').toUpperCase()
    if (normalized.length > 0) {
      if (VAT_ID.test(normalized)) vatId = normalized
      else issue('vatId', 'Neispravan PDV ID. Primjer: DE123456789.')
    }
  }

  if (isBusiness) {
    if (!input.street) issue('street', REQUIRED)
    if (!input.postalCode) issue('postalCode', REQUIRED)
    if (!input.city) issue('city', REQUIRED)
  }
  if (isCroatian && input.postalCode && !/^\d{5}$/.test(input.postalCode)) {
    issue('postalCode', 'Poštanski broj mora imati 5 znamenki.')
  }

  return {
    kind: input.kind,
    name: input.name,
    oib,
    vatId,
    street: input.street,
    postalCode: input.postalCode,
    city: input.city,
    countryCode: input.countryCode,
    email: input.email,
    note: input.note,
  }
})

export type CustomerInput = z.output<typeof customerSchema>

export const customerIdSchema = z.uuid({ error: 'Neispravan zahtjev.' })
