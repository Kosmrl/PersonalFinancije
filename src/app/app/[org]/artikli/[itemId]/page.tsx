import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArchiveButton } from '@/components/items/archive-button'
import { ItemForm } from '@/components/items/item-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { decimalToInputText } from '@/lib/money'
import { formatKpd } from '@/lib/validation/kpd'
import { requireOrgContext } from '@/server/auth/context'
import { getItem } from '@/server/items/queries'

// The item name is not put in the page title.
export const metadata: Metadata = { title: 'Artikl' }

export default async function ItemPage({
  params,
}: {
  params: Promise<{ org: string; itemId: string }>
}) {
  const { org, itemId } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate
  const item = await getItem(ctx, itemId)
  const archived = item.archivedAt !== null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/app/${ctx.orgSlug}/artikli`}
          className="text-muted-foreground text-sm underline"
        >
          Natrag na artikle
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Uredi artikl</h1>
          <ArchiveButton orgSlug={ctx.orgSlug} itemId={item.id} archived={archived} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podaci o artiklu</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemForm
            mode="edit"
            orgSlug={ctx.orgSlug}
            itemId={item.id}
            archived={archived}
            initial={{
              name: item.name,
              description: item.description ?? '',
              unitCode: item.unitCode,
              unitPrice: decimalToInputText(item.unitPrice),
              kpdCode: item.kpdCode ? formatKpd(item.kpdCode) : '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
