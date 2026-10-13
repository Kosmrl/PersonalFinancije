import { notFound, redirect } from 'next/navigation'
import { OrgSwitcher } from '@/components/app-shell/org-switcher'
import { Sidebar } from '@/components/app-shell/sidebar'
import { UserMenu } from '@/components/app-shell/user-menu'
import { requireOrgContext, requireUser } from '@/server/auth/context'
import { getObrtProfile, isSoleMember, listMyOrganizations } from '@/server/org/queries'

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ org: string }>
}) {
  const { org } = await params
  // Real authorization for every page below: membership is read from the database. A user who
  // is not a member (or an unknown slug) gets the 404 page.
  const gate = await requireOrgContext(org)
  if (!gate.ok) notFound()
  const { ctx } = gate
  const { user } = await requireUser()

  const profile = await getObrtProfile(ctx)
  // Only the sole member can finish it (see isSoleMember); a co-member sees the notice below
  // instead of being bounced to a page that would refuse them.
  if (!profile && ctx.role === 'owner' && (await isSoleMember(ctx))) {
    // The organization exists but onboarding stopped before the profile was saved.
    redirect(`/app/novi-obrt?org=${encodeURIComponent(ctx.orgSlug)}`)
  }

  const orgs = await listMyOrganizations(user.id)
  const current = orgs.find((item) => item.slug === ctx.orgSlug)

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar border-b p-3 md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex flex-col gap-3">
          <p className="px-1 text-sm font-semibold tracking-tight">PersonalFinancije</p>
          <OrgSwitcher
            current={{
              slug: ctx.orgSlug,
              name: profile?.tradeName ?? current?.name ?? ctx.orgSlug,
            }}
            orgs={orgs.map(({ slug, name }) => ({ slug, name }))}
          />
          <Sidebar orgSlug={ctx.orgSlug} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end border-b px-4 py-2">
          <UserMenu email={user.email} />
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
          {profile ? (
            children
          ) : (
            <p>Vlasnik obrta još nije dovršio postavljanje podataka o obrtu.</p>
          )}
        </main>
      </div>
    </div>
  )
}
