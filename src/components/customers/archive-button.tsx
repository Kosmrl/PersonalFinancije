'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { archiveCustomer, restoreCustomer } from '@/server/customers/actions'

export function ArchiveButton({
  orgSlug,
  customerId,
  archived,
}: {
  orgSlug: string
  customerId: string
  archived: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run() {
    startTransition(async () => {
      const result = await (archived ? restoreCustomer : archiveCustomer)({ orgSlug, customerId })
      if (result.ok) {
        toast.success(archived ? 'Kupac je vraćen.' : 'Kupac je arhiviran.')
        router.refresh()
      } else {
        toast.error(result.fieldErrors?.oib ?? result.message)
      }
    })
  }

  return (
    <Button type="button" variant="outline" onClick={run} disabled={pending}>
      {archived ? 'Vrati' : 'Arhiviraj'}
    </Button>
  )
}
