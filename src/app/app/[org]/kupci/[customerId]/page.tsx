import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArchiveButton } from '@/components/customers/archive-button'
import { CustomerForm } from '@/components/customers/customer-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext } from '@/server/auth/context'
import { getCustomer } from '@/server/customers/queries'

// The customer's name is personal data: it is not put in the page title.
export const metadata: Metadata = { title: 'Kupac' }

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ org: string; customerId: string }>
}) {
  const { org, customerId } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate
  const customer = await getCustomer(ctx, customerId)
  const archived = customer.archivedAt !== null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/app/${ctx.orgSlug}/kupci`}
          className="text-muted-foreground text-sm underline"
        >
          Natrag na kupce
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Uredi kupca</h1>
          <ArchiveButton orgSlug={ctx.orgSlug} customerId={customer.id} archived={archived} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podaci o kupcu</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm
            mode="edit"
            orgSlug={ctx.orgSlug}
            customerId={customer.id}
            archived={archived}
            initial={{
              kind: customer.kind === 'business' ? 'business' : 'person',
              name: customer.name,
              oib: customer.oib ?? '',
              vatId: customer.vatId ?? '',
              street: customer.street ?? '',
              postalCode: customer.postalCode ?? '',
              city: customer.city ?? '',
              countryCode: customer.countryCode,
              email: customer.email ?? '',
              note: customer.note ?? '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
