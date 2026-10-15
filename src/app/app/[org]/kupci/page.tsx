import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CustomerSearch } from '@/components/customers/customer-search'
import { CustomerTable } from '@/components/customers/customer-table'
import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { buttonVariants } from '@/components/ui/button'
import { requireOrgContext } from '@/server/auth/context'
import { listCustomers } from '@/server/customers/queries'
import { throwForE2e } from '@/server/test-hooks'

export const metadata: Metadata = { title: 'Kupci' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: SearchParams
}) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate

  const query = await searchParams
  throwForE2e(query.e2eError) // test-only hook, inert outside the e2e stack
  const showArchived = single(query.archived) === '1'
  const pageText = single(query.page)
  const pageParam = /^\d{1,6}$/.test(pageText) ? parseInt(pageText, 10) : 1

  // The search term is deliberately not a URL parameter (it can be an OIB or an e-mail address);
  // see CustomerSearch. Only `archived` and `page` are in the URL.
  const list = await listCustomers(ctx, { archived: showArchived, page: pageParam })

  const base = `/app/${ctx.orgSlug}/kupci`
  const hrefFor = (page: number) => {
    const search = new URLSearchParams()
    if (showArchived) search.set('archived', '1')
    if (page > 1) search.set('page', String(page))
    const text = search.toString()
    return text ? `${base}?${text}` : base
  }
  // A page past the end (stale link, customers archived meanwhile): go to the last page.
  if (list.rows.length === 0 && list.total > 0) {
    redirect(hrefFor(Math.ceil(list.total / list.pageSize)))
  }
  const newButton = (
    <Link href={`${base}/novi`} className={buttonVariants()}>
      Novi kupac
    </Link>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Kupci</h1>
        {newButton}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={showArchived ? base : `${base}?archived=1`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {showArchived ? 'Sakrij arhivirane' : 'Prikaži arhivirane'}
        </Link>
      </div>
      <CustomerSearch orgSlug={ctx.orgSlug} archived={showArchived}>
        {list.rows.length === 0 ? (
          showArchived ? (
            <EmptyState title="Nema kupaca za prikaz." />
          ) : (
            <EmptyState title="Još nemate kupaca.">{newButton}</EmptyState>
          )
        ) : (
          <>
            <CustomerTable orgSlug={ctx.orgSlug} rows={list.rows} />
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              hrefFor={hrefFor}
            />
          </>
        )}
      </CustomerSearch>
    </div>
  )
}
