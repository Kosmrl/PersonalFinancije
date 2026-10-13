import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ObrtProfileForm } from '@/components/org/obrt-profile-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext } from '@/server/auth/context'
import { getObrtProfile } from '@/server/org/queries'

export const metadata: Metadata = { title: 'Postavke obrta' }

export default async function ObrtSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate
  const profile = await getObrtProfile(ctx)
  if (!profile) notFound()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Postavke obrta</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podaci o obrtu</CardTitle>
          <CardDescription>Prikazuju se na vašim računima.</CardDescription>
        </CardHeader>
        <CardContent>
          <ObrtProfileForm
            mode="edit"
            orgSlug={ctx.orgSlug}
            readOnly={ctx.role !== 'owner'}
            initial={{
              tradeName: profile.tradeName,
              ownerFullName: profile.ownerFullName,
              oib: profile.oib,
              street: profile.street,
              postalCode: profile.postalCode,
              city: profile.city,
              iban: profile.iban,
              email: profile.email,
              phone: profile.phone ?? '',
              website: profile.website ?? '',
              defaultInvoiceNote: profile.defaultInvoiceNote,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
