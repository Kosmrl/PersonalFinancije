import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDecimal } from '@/lib/money'
import { formatKpd } from '@/lib/validation/kpd'
import { unitLabel } from '@/server/items/units'
import type { ItemListRow } from '@/server/items/queries'

export function ItemTable({ orgSlug, rows }: { orgSlug: string; rows: ItemListRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naziv</TableHead>
          <TableHead>Jedinica</TableHead>
          <TableHead className="text-right">Cijena</TableHead>
          <TableHead>KPD</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className={row.archived ? 'text-muted-foreground' : undefined}>
            <TableCell className="font-medium break-words whitespace-normal">
              <Link
                href={`/app/${orgSlug}/artikli/${row.id}`}
                className="underline-offset-4 hover:underline"
              >
                {row.name}
              </Link>
              {row.archived ? (
                <Badge variant="secondary" className="ml-2">
                  Arhiviran
                </Badge>
              ) : null}
            </TableCell>
            <TableCell>{unitLabel(row.unitCode)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatDecimal(row.unitPrice, row.currency)}
            </TableCell>
            <TableCell>{row.kpdCode ? formatKpd(row.kpdCode) : '–'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
