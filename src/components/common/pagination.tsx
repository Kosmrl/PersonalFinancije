import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Previous/next links for a server-rendered list. `hrefFor` builds the URL of a page number. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number
  pageSize: number
  total: number
  hrefFor: (page: number) => string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const link = cn(buttonVariants({ variant: 'outline', size: 'sm' }))
  return (
    <nav aria-label="Stranice" className="flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={link} rel="prev">
          Prethodna
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Stranica {page} od {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className={link} rel="next">
          Sljedeća
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
