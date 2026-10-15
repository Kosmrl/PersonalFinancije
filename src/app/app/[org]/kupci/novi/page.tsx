import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CustomerForm, EMPTY_CUSTOMER } from '@/components/customers/customer-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext } from '@/server/auth/context'

export const metadata: Metadata = { title: 'Novi kupac' }

export default async function NewCustomerPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/app/${ctx.orgSlug}/kupci`}
          className="text-muted-foreground text-sm underline"
        >
          Natrag na kupce
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Novi kupac</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podaci o kupcu</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm mode="create" orgSlug={ctx.orgSlug} initial={EMPTY_CUSTOMER} />
        </CardContent>
      </Card>
    </div>
  )
}
