import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Circle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOrgContext, requireUser } from '@/server/auth/context'
import { getObrtProfile, getOnboardingCounts } from '@/server/org/queries'

export const metadata: Metadata = { title: 'Nadzorna ploča' }

type Step = { label: string; done: boolean; href?: string }

export default async function DashboardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const orgSlug = gate.ctx.orgSlug
  const { user } = await requireUser()
  const [profile, counts] = await Promise.all([
    getObrtProfile(gate.ctx),
    getOnboardingCounts(gate.ctx),
  ])

  const steps: Step[] = [
    { label: 'Podaci o obrtu', done: Boolean(profile) },
    { label: 'Dodajte kupca', done: counts.customers > 0, href: `/app/${orgSlug}/kupci/novi` },
    { label: 'Dodajte artikl', done: counts.items > 0, href: `/app/${orgSlug}/artikli/novi` },
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
