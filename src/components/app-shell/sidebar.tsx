'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Package, Settings, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

type Item = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Not built yet: shown greyed out with "Uskoro". */
  soon?: boolean
}

export function Sidebar({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  const base = `/app/${orgSlug}`
  const items: Item[] = [
    { label: 'Nadzorna ploča', href: base, icon: LayoutDashboard },
    { label: 'Kupci', href: `${base}/kupci`, icon: Users, soon: true },
    { label: 'Artikli', href: `${base}/artikli`, icon: Package, soon: true },
    { label: 'Postavke', href: `${base}/postavke/obrt`, icon: Settings },
  ]
  const settings: Item[] = [
    { label: 'Obrt', href: `${base}/postavke/obrt`, icon: Settings },
    { label: 'Članovi', href: `${base}/postavke/clanovi`, icon: Users },
  ]
  const inSettings = pathname.startsWith(`${base}/postavke`)

  function isActive(href: string) {
    return href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`)
  }

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors',
      active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
        : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
    )

  return (
    <nav aria-label="Glavna navigacija" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((item) => {
        const Icon = item.icon
        if (item.soon) {
          return (
            <span
              key={item.label}
              aria-disabled="true"
              className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap"
            >
              <Icon className="size-4" />
              {item.label}
              <span className="bg-muted rounded px-1.5 py-0.5 text-xs">Uskoro</span>
            </span>
          )
        }
        const active = item.label === 'Postavke' ? inSettings : isActive(item.href)
        return (
          <div key={item.label} className="flex flex-col gap-1">
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={linkClass(active)}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
            {item.label === 'Postavke' && inSettings ? (
              <div className="ml-4 flex flex-col gap-1 max-md:hidden">
                {settings.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    aria-current={isActive(sub.href) ? 'page' : undefined}
                    className={linkClass(isActive(sub.href))}
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
