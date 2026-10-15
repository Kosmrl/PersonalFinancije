'use client'

import { useState, useTransition } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { CustomerTable } from '@/components/customers/customer-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CustomerList } from '@/server/customers/queries'
import { searchCustomers } from '@/server/customers/actions'

// Search box of the customer list. The term can be an OIB or an e-mail address (personal data), so
// it lives only in component state and travels as a server action argument: it never reaches the
// URL, the browser history or the access logs. With an empty term the server-rendered list
// (`children`, paginated by URL) is shown; with a term the results come from the action.
export function CustomerSearch({
  orgSlug,
  archived,
  children,
}: {
  orgSlug: string
  archived: boolean
  children: React.ReactNode
}) {
  const [input, setInput] = useState('')
  const [term, setTerm] = useState('')
  const [result, setResult] = useState<CustomerList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(q: string, page: number) {
    startTransition(async () => {
      const response = await searchCustomers({ orgSlug, q, archived, page })
      if (response.ok) {
        setError(null)
        setTerm(q)
        setResult(response.data)
      } else {
        setError(response.message)
      }
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const q = input.trim()
    if (!q) return clear()
    run(q, 1)
  }

  function clear() {
    setInput('')
    setTerm('')
    setResult(null)
    setError(null)
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1

  return (
    <>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3" role="search">
        <Input
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={100}
          autoComplete="off"
          placeholder="Pretraži po nazivu, OIB-u ili e-pošti"
          aria-label="Pretraga kupaca"
          className="w-full sm:w-80"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          Traži
        </Button>
        {result ? (
          <Button type="button" variant="ghost" onClick={clear}>
            Poništi pretragu
          </Button>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {result === null ? (
        children
      ) : result.rows.length === 0 ? (
        <EmptyState title={`Nema rezultata za „${term}“.`} />
      ) : (
        <>
          <CustomerTable orgSlug={orgSlug} rows={result.rows} />
          {pages > 1 ? (
            <nav aria-label="Stranice" className="flex items-center justify-between gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={pending || result.page <= 1}
                onClick={() => run(term, result.page - 1)}
              >
                Prethodna
              </Button>
              <span className="text-muted-foreground">
                Stranica {result.page} od {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pending || result.page >= pages}
                onClick={() => run(term, result.page + 1)}
              >
                Sljedeća
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
