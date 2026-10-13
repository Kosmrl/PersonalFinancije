import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FormNotice } from '@/components/common/field-error'
import { ObrtProfileForm, type ObrtProfileValues } from '@/components/org/obrt-profile-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext, requireUser } from '@/server/auth/context'
import { DEFAULT_INVOICE_NOTE } from '@/server/org/schemas'
import { getObrtProfile, isSoleMember } from '@/server/org/queries'

export const metadata: Metadata = { title: 'Novi obrt' }

type SearchParams = Promise<{ org?: string | string[] }>

const EMPTY: ObrtProfileValues = {
  tradeName: '',
  ownerFullName: '',
  oib: '',
  street: '',
  postalCode: '',
  city: '',
  iban: '',
  email: '',
  phone: '',
  website: '',
  defaultInvoiceNote: DEFAULT_INVOICE_NOTE,
}

export default async function NoviObrtPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireUser()
  const { org } = await searchParams

  // `?org=<slug>`: an organization that was created but whose profile is missing (the profile
  // step failed). Only its owner can finish it.
  let existingOrgSlug: string | undefined
  if (typeof org === 'string' && org) {
    const gate = await requireOrgContext(org, { roles: ['owner'] })
    if (!gate.ok) return <Unavailable />
    if (await getObrtProfile(gate.ctx)) redirect(`/app/${gate.ctx.orgSlug}`)
    if (!(await isSoleMember(gate.ctx))) return <Unavailable />

    existingOrgSlug = gate.ctx.orgSlug
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-muted-foreground text-sm underline">
          Natrag
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Podaci o obrtu</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Postavite svoj obrt</CardTitle>
          <CardDescription>
            Ovi se podaci prikazuju na vašim računima. Prijavljeni ste kao {user.email}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {existingOrgSlug ? (
            <FormNotice>Dovršite unos podataka o obrtu koji ste već započeli.</FormNotice>
          ) : null}
          <ObrtProfileForm mode="create" initial={EMPTY} existingOrgSlug={existingOrgSlug} />
        </CardContent>
      </Card>
    </main>
  )
}

function Unavailable() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <p>Stranica ne postoji ili nemate pristup.</p>
      <Link href="/app" className="underline">
        Natrag
      </Link>
    </main>
  )
}
