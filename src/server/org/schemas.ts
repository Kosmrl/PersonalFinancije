import 'server-only'
import { z } from 'zod'
import { ibanCountryCode, isValidIban, normalizeIban } from '@/lib/validation/iban'
import { isValidOib, normalizeOib } from '@/lib/validation/oib'

// Input schemas for the organization actions (plan: "Server actions", obrt_profiles rules).
// Every string is trimmed; messages are Croatian and become field errors.

export const DEFAULT_INVOICE_NOTE =
  'Obveznik nije u sustavu PDV-a, PDV nije obračunat temeljem čl. 90. st. 1. Zakona o PDV-u.'

export const OIB_TAKEN_MESSAGE =
  'Obrt s tim OIB-om već je registriran. Zatražite pozivnicu od vlasnika.'
export const NOT_IN_VAT_MESSAGE =
  'Aplikacija je trenutno namijenjena paušalistima izvan sustava PDV-a.'

const REQUIRED = 'Obavezno polje.'

const text = (max: number) =>
  z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(max, `Najviše ${max} znakova.`)

// Optional free text: empty after trimming means "not given".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Najviše ${max} znakova.`)
    .optional()
    .transform((value) => (value ? value : null))

const oib = z
  .string({ error: REQUIRED })
  .transform(normalizeOib)
  .refine((value) => value.length > 0, REQUIRED)
  .refine((value) => value.length === 0 || isValidOib(value), 'Neispravan OIB.')

const iban = z
  .string({ error: REQUIRED })
  .transform(normalizeIban)
  .refine((value) => value.length > 0, REQUIRED)
  .refine((value) => value.length === 0 || isValidIban(value), 'Neispravan IBAN.')

const email = z
  .string({ error: REQUIRED })
  .trim()
  .min(1, REQUIRED)
  .max(254, 'Najviše 254 znaka.')
  .pipe(z.email('Unesite ispravnu adresu e-pošte.'))
  .transform((value) => value.toLowerCase())

const website = optionalText(200).refine((value) => {
  if (value === null) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}, 'Unesite ispravan URL, npr. https://primjer.hr.')

// Fields shared by onboarding and the profile form. The OIB is deliberately not part of the
// update schema: it is set once (plan: "OIB immutability").
const profileFields = {
  tradeName: text(200),
  ownerFullName: text(200),
  street: text(200),
  postalCode: z
    .string({ error: REQUIRED })
    .trim()
    .regex(/^\d{5}$/, 'Poštanski broj mora imati 5 znamenki.'),
  city: text(100),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .default('HR')
    .refine((value) => value === 'HR', 'Trenutno je podržana samo Hrvatska.'),
  iban,
  email,
  phone: optionalText(50),
  website,
  defaultInvoiceNote: text(1000),
}

const orgSlugField = z
  .string({ error: REQUIRED })
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Neispravan obrt.')

export const updateObrtProfileSchema = z.object({ orgSlug: orgSlugField, ...profileFields })

export const createOrganizationSchema = z.object({
  ...profileFields,
  oib,
  // Set when finishing onboarding of an organization that already exists without a profile.
  existingOrgSlug: orgSlugField.optional(),
  // Must be literally true; the form sends the checkbox state.
  declareNotInVat: z.literal(true, { error: NOT_IN_VAT_MESSAGE }),
})

export const INVITABLE_ROLES = ['accountant', 'member'] as const
export const ASSIGNABLE_ROLES = ['owner', 'accountant', 'member'] as const

// Better Auth ids are 32 alphanumeric characters. Only the shape is checked here (so a lookup
// never receives a huge or odd string); existence and ownership are checked against the database.
const entityId = z
  .string({ error: 'Neispravan zahtjev.' })
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Neispravan zahtjev.')

export const inviteMemberSchema = z.object({
  orgSlug: orgSlugField,
  email,
  role: z.enum(INVITABLE_ROLES, { error: 'Odaberite ulogu.' }),
})
export const revokeInvitationSchema = z.object({ orgSlug: orgSlugField, invitationId: entityId })
export const changeMemberRoleSchema = z.object({
  orgSlug: orgSlugField,
  memberId: entityId,
  role: z.enum(ASSIGNABLE_ROLES, { error: 'Odaberite ulogu.' }),
})
export const removeMemberSchema = z.object({ orgSlug: orgSlugField, memberId: entityId })
export const invitationIdSchema = z.object({ invitationId: entityId })

/** True for a valid IBAN of a country other than Croatia (accepted, with a warning). */
export function isNonHrIban(normalizedIban: string): boolean {
  const country = ibanCountryCode(normalizedIban)
  return country !== null && country !== 'HR'
}

/** The first message per top-level field, for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : '_'
    out[key] ??= issue.message
  }
  return out
}
