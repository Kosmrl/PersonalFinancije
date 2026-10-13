import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Circle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext, requireUser } from '@/server/auth/context'
import { getObrtProfile } from '@/server/org/queries'

export const metadata: Metadata = { title: 'Nadzorna ploča' }

type Step = { label: string; done: boolean; href?: string }

export default async function DashboardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { user } = await requireUser()
  const profile = await getObrtProfile(gate.ctx)

  // Kupci and artikli arrive in steps 7 and 8; until then those items are not links.
  const steps: Step[] = [
    { label: 'Podaci o obrtu', done: Boolean(profile) },
    { label: 'Dodajte kupca', done: false },
    { label: 'Dodajte artikl', done: false },
    {
      label: 'Uključite dvofaktorsku prijavu',
      done: user.twoFactorEnabled === true,
      href: '/app/profil/sigurnost',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{profile?.tradeName}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prvi koraci</CardTitle>
          <CardDescription>Nekoliko koraka do prvog računa.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2 text-sm">
                {step.done ? (
                  <CheckCircle2 className="size-4 text-green-600" aria-label="Završeno" />
                ) : (
                  <Circle className="text-muted-foreground size-4" aria-label="Nije završeno" />
                )}
                {step.href && !step.done ? (
                  <Link href={step.href} className="underline">
                    {step.label}
                  </Link>
                ) : (
                  <span className={step.done ? 'text-muted-foreground' : undefined}>
                    {step.label}
                    {!step.href && !step.done ? (
                      <span className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs">Uskoro</span>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
