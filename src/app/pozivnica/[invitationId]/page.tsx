import type { Metadata } from 'next'
import Link from 'next/link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { InvitationActions } from '@/components/org/invitation-actions'
import { roleLabel } from '@/components/org/roles'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSession } from '@/server/auth/context'
import { INVITATION_MESSAGES } from '@/server/org/messages'
import { getInvitationView } from '@/server/org/queries'

export const metadata: Metadata = { title: 'Pozivnica' }

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>
}) {
  const { invitationId } = await params
  const session = await getSession()
  const shell = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <p className="text-center text-lg font-semibold tracking-tight">PersonalFinancije</p>
      {children}
    </main>
  )

  // Not signed in (or the address is not verified yet): nothing about the invitation is shown.
  if (!session?.user || !session.user.emailVerified) {
    const next = encodeURIComponent(`/pozivnica/${invitationId}`)
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Pozivnica za obrt</CardTitle>
          <CardDescription>
            Za prihvaćanje pozivnice prijavite se računom čija je e-pošta ona na koju je pozivnica
            poslana.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild>
            <Link href={`/prijava?next=${next}`}>Prijavi se</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/registracija">Registriraj se</Link>
          </Button>
          <p className="text-muted-foreground text-sm">
            Nakon registracije i potvrde e-pošte ponovno otvorite poveznicu iz pozivnice.
          </p>
        </CardContent>
      </Card>,
    )
  }

  const view = await getInvitationView(session.user, invitationId)

  if (view.state === 'open') {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Pozvani ste u obrt</CardTitle>
          <CardDescription>
            Obrt: <strong className="text-foreground">{view.orgName}</strong>. Uloga:{' '}
            <strong className="text-foreground">{roleLabel(view.role)}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationActions invitationId={invitationId} />
        </CardContent>
      </Card>,
    )
  }

  const message = INVITATION_MESSAGES[view.state]
  const href = view.state === 'already_member' ? `/app/${view.orgSlug}` : '/app'
  return shell(
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Pozivnica</CardTitle>
        <CardDescription role="alert">{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={href}>Natrag na aplikaciju</Link>
        </Button>
        {view.state === 'wrong_recipient' ? <SignOutButton /> : null}
      </CardContent>
    </Card>,
  )
}
