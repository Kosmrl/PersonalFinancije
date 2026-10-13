'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { changeMemberRole, removeMember, revokeInvitation } from '@/server/org/actions'
import { roleLabel } from './roles'

export type MemberItem = {
  id: string
  email: string
  role: string
  joined: string
  isSelf: boolean
}

export type InvitationItem = {
  id: string
  email: string
  role: string | null
  expires: string
}

export function MembersTable({
  orgSlug,
  members,
  canManage,
}: {
  orgSlug: string
  members: MemberItem[]
  canManage: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  function run(id: string, action: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    setBusyId(id)
    startTransition(async () => {
      const result = await action()
      setBusyId(null)
      if (result.ok) toast.success(done)
      else toast.error(result.message ?? 'Došlo je do pogreške.')
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>E-pošta</TableHead>
          <TableHead>Uloga</TableHead>
          <TableHead>Član od</TableHead>
          {canManage ? <TableHead className="text-right">Radnje</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="break-all">
              {row.email}
              {row.isSelf ? <span className="text-muted-foreground"> (vi)</span> : null}
            </TableCell>
            <TableCell>
              {canManage ? (
                <Select
                  value={row.role.split(',')[0]?.trim()}
                  disabled={pending && busyId === row.id}
                  onValueChange={(role) =>
                    run(
                      row.id,
                      () => changeMemberRole({ orgSlug, memberId: row.id, role }),
                      'Uloga je promijenjena.',
                    )
                  }
                >
                  <SelectTrigger size="sm" aria-label={`Uloga: ${row.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Vlasnik</SelectItem>
                    <SelectItem value="accountant">Knjigovođa</SelectItem>
                    <SelectItem value="member">Član</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                roleLabel(row.role)
              )}
            </TableCell>
            <TableCell>{row.joined}</TableCell>
            {canManage ? (
              <TableCell className="text-right">
                {row.isSelf ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending && busyId === row.id}
                    onClick={() => {
                      if (!window.confirm(`Ukloniti člana ${row.email}?`)) return
                      run(
                        row.id,
                        () => removeMember({ orgSlug, memberId: row.id }),
                        'Član je uklonjen.',
                      )
                    }}
                  >
                    Ukloni
                  </Button>
                )}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PendingInvitationsTable({
  orgSlug,
  invitations,
  canManage,
}: {
  orgSlug: string
  invitations: InvitationItem[]
  canManage: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (invitations.length === 0) {
    return <p className="text-muted-foreground text-sm">Nema pozivnica na čekanju.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>E-pošta</TableHead>
          <TableHead>Uloga</TableHead>
          <TableHead>Vrijedi do</TableHead>
          {canManage ? <TableHead className="text-right">Radnje</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="break-all">{row.email}</TableCell>
            <TableCell>{roleLabel(row.role)}</TableCell>
            <TableCell>{row.expires}</TableCell>
            {canManage ? (
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending && busyId === row.id}
                  onClick={() => {
                    setBusyId(row.id)
                    startTransition(async () => {
                      const result = await revokeInvitation({ orgSlug, invitationId: row.id })
                      setBusyId(null)
                      if (result.ok) toast.success('Pozivnica je opozvana.')
                      else toast.error(result.message)
                    })
                  }}
                >
                  Opozovi
                </Button>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
