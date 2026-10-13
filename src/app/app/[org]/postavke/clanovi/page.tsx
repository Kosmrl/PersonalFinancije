import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { InviteForm } from '@/components/org/invite-form'
import {
  MembersTable,
  PendingInvitationsTable,
  type InvitationItem,
  type MemberItem,
} from '@/components/org/members-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCalendarDate, formatZagrebDateTime, toZagrebCalendarDate } from '@/lib/dates/zagreb'
import { requireOrgContext } from '@/server/auth/context'
import { listMembers, listPendingInvitations } from '@/server/org/queries'

export const metadata: Metadata = { title: 'Članovi' }

export default async function MembersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate
  const isOwner = ctx.role === 'owner'

  const [memberRows, invitationRows] = await Promise.all([
    listMembers(ctx),
    listPendingInvitations(ctx),
  ])
  const members: MemberItem[] = memberRows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    joined: formatCalendarDate(toZagrebCalendarDate(row.joinedAt)),
    isSelf: row.userId === ctx.userId,
  }))
  const invitations: InvitationItem[] = invitationRows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expires: formatZagrebDateTime(row.expiresAt),
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Članovi</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Članovi obrta</CardTitle>
          <CardDescription>Osobe koje imaju pristup ovom obrtu.</CardDescription>
        </CardHeader>
        <CardContent>
          <MembersTable orgSlug={ctx.orgSlug} members={members} canManage={isOwner} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pozivnice na čekanju</CardTitle>
        </CardHeader>
        <CardContent>
          <PendingInvitationsTable
            orgSlug={ctx.orgSlug}
            invitations={invitations}
            canManage={isOwner}
          />
        </CardContent>
      </Card>
      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pozovi člana</CardTitle>
            <CardDescription>
              Osoba može otvoriti račun i nakon što primi pozivnicu, ali mora potvrditi adresu
              e-pošte na koju šaljete pozivnicu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm orgSlug={ctx.orgSlug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
