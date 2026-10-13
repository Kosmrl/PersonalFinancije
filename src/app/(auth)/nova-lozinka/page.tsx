import type { Metadata } from 'next'
import Link from 'next/link'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { FormError } from '@/components/common/field-error'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Nova lozinka' }

type SearchParams = Promise<{ token?: string; error?: string }>

// Better Auth redirects here from the emailed link with ?token=... or ?error=INVALID_TOKEN.
export default async function NovaLozinkaPage({ searchParams }: { searchParams: SearchParams }) {
  const { token, error } = await searchParams
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Nova lozinka</CardTitle>
        <CardDescription>Odaberite novu lozinku za svoj račun.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error || !token ? (
          <>
            <FormError message="Poveznica je nevažeća ili je istekla." />
            <Link href="/zaboravljena-lozinka" className="text-foreground text-sm underline">
              Zatražite novu poveznicu
            </Link>
          </>
        ) : (
          <ResetPasswordForm token={token} />
        )}
      </CardContent>
    </Card>
  )
}
