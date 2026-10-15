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
import { countryName } from '@/lib/countries'
import type { CustomerListRow } from '@/server/customers/queries'

const KIND_LABEL: Record<string, string> = {
  person: 'Fizička osoba',
  business: 'Poslovni subjekt',
}

export function CustomerTable({ orgSlug, rows }: { orgSlug: string; rows: CustomerListRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naziv</TableHead>
          <TableHead>Vrsta</TableHead>
          <TableHead>OIB / PDV ID</TableHead>
          <TableHead>Mjesto</TableHead>
          <TableHead>E-pošta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className={row.archived ? 'text-muted-foreground' : undefined}>
            <TableCell className="font-medium break-words whitespace-normal">
              <Link
                href={`/app/${orgSlug}/kupci/${row.id}`}
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
            <TableCell>{KIND_LABEL[row.kind] ?? row.kind}</TableCell>
            <TableCell>{row.oib ?? row.vatId ?? '–'}</TableCell>
            <TableCell className="whitespace-normal">
              {row.city ? row.city : '–'}
              {row.countryCode !== 'HR' ? `, ${countryName(row.countryCode)}` : ''}
            </TableCell>
            <TableCell className="break-all whitespace-normal">{row.email ?? '–'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
