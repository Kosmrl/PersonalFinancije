'use client'

import Link from 'next/link'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type SwitcherOrg = { slug: string; name: string }

export function OrgSwitcher({ current, orgs }: { current: SwitcherOrg; orgs: SwitcherOrg[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-full justify-between gap-2">
          <span className="truncate">{current.name}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Vaši obrti</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem key={org.slug} asChild>
            <Link href={`/app/${org.slug}`}>
              <span className="flex-1 truncate">{org.name}</span>
              {org.slug === current.slug ? <Check className="size-4" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/novi-obrt">Dodaj novi obrt</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
