import type { Metadata } from 'next'
import Link from 'next/link'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireUser } from '@/server/auth/context'

export const metadata: Metadata = { title: 'Početna' }

// Minimal landing page for a signed-in user (step 4). Step 6 replaces it with the organization
// redirect and picker (0 orgs -> onboarding, 1 -> that org, more -> list).
export default async function AppPage() {
  await requireUser()
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Dobrodošli</CardTitle>
          <CardDescription>
            Prijavljeni ste. Postavljanje obrta slijedi u sljedećem koraku.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Link href="/app/profil/sigurnost" className="text-sm underline">
            Sigurnost računa
          </Link>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  )
}
