import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EMPTY_ITEM, ItemForm } from '@/components/items/item-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext } from '@/server/auth/context'

export const metadata: Metadata = { title: 'Novi artikl' }

export default async function NewItemPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/app/${ctx.orgSlug}/artikli`}
          className="text-muted-foreground text-sm underline"
        >
          Natrag na artikle
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Novi artikl</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podaci o artiklu</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemForm mode="create" orgSlug={ctx.orgSlug} initial={EMPTY_ITEM} />
        </CardContent>
      </Card>
    </div>
  )
}
