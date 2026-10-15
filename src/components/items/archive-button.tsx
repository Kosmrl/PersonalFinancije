'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { archiveItem, restoreItem } from '@/server/items/actions'

export function ArchiveButton({
  orgSlug,
  itemId,
  archived,
}: {
  orgSlug: string
  itemId: string
  archived: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run() {
    startTransition(async () => {
      const result = await (archived ? restoreItem : archiveItem)({ orgSlug, itemId })
      if (result.ok) {
        toast.success(archived ? 'Artikl je vraćen.' : 'Artikl je arhiviran.')
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Button type="button" variant="outline" onClick={run} disabled={pending}>
      {archived ? 'Vrati' : 'Arhiviraj'}
    </Button>
  )
}
