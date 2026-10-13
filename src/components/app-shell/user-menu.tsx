'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleUser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { authClient } from '@/lib/auth-client'

export function UserMenu({ email }: { email: string }) {
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    router.replace('/prijava')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-56 gap-2" aria-label="Korisnički izbornik">
          <CircleUser className="size-4 shrink-0" />
          <span className="truncate max-sm:hidden">{email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/profil/sigurnost">Sigurnost računa</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>Odjava</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
