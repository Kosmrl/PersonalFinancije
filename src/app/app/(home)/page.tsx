import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { requireUser } from '@/server/auth/context'
import { listMyOrganizations } from '@/server/org/queries'
import { roleLabel } from '@/components/org/roles'
import { UserMenu } from '@/components/app-shell/user-menu'

export const metadata: Metadata = { title: 'Početna' }

// 0 organizations -> onboarding, 1 -> its dashboard, more -> a picker.
export default async function AppPage() {
  const { user } = await requireUser()
  const orgs = await listMyOrganizations(user.id)
  if (orgs.length === 0) redirect('/app/novi-obrt')
  if (orgs.length === 1) redirect(`/app/${orgs[0]!.slug}`)

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Odaberite obrt</h1>
        <UserMenu email={user.email} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vaši obrti</CardTitle>
          <CardDescription>Odaberite obrt s kojim želite raditi.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/app/${org.slug}`}
              className="hover:bg-muted flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
            >
              <span className="truncate font-medium">{org.name}</span>
              <span className="text-muted-foreground">{roleLabel(org.role)}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Button asChild variant="outline">
        <Link href="/app/novi-obrt">Dodaj novi obrt</Link>
      </Button>
    </main>
  )
}
