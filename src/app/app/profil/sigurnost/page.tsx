import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { ChangePasswordForm } from '@/components/security/change-password-form'
import { SessionsList, type SessionRow } from '@/components/security/sessions-list'
import { TotpSection } from '@/components/security/totp-section'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuth } from '@/server/auth/auth'
import { requireUser } from '@/server/auth/context'
import { formatZagrebDateTime } from '@/lib/dates/zagreb'

export const metadata: Metadata = { title: 'Sigurnost računa' }

export default async function SigurnostPage() {
  const { user, session } = await requireUser()
  const list = await getAuth().api.listSessions({ headers: await headers() })

  const rows: SessionRow[] = list.map((item) => ({
    id: item.id,
    token: item.token,
    userAgent: item.userAgent ?? null,
    createdAt: formatZagrebDateTime(item.createdAt),
    lastSeenAt: formatZagrebDateTime(item.updatedAt),
    current: item.id === session.id,
  }))

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-muted-foreground text-sm underline">
          Natrag
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Sigurnost računa</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Promjena lozinke</CardTitle>
          <CardDescription>Nakon promjene ostale se sesije odjavljuju.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Dvofaktorska prijava (TOTP)</CardTitle>
          <CardDescription>
            Uz lozinku se traži i kod iz aplikacije za provjeru. Preporučujemo je uključiti.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TotpSection enabled={user.twoFactorEnabled === true} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Aktivne sesije</CardTitle>
          <CardDescription>Uređaji na kojima ste prijavljeni.</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsList sessions={rows} />
        </CardContent>
      </Card>
    </main>
  )
}
