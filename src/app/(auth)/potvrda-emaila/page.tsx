import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ResendVerificationForm } from '@/components/auth/resend-verification-form'
import { FormError } from '@/components/common/field-error'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSession } from '@/server/auth/context'

export const metadata: Metadata = { title: 'Potvrda e-pošte' }

type SearchParams = Promise<{ error?: string }>

// Landing page of the verification link (Better Auth redirects here, with ?error=... on
// failure) and the "check your inbox" page after sign-up.
export default async function PotvrdaEmailaPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams

  if (!error) {
    // A successful verification signs the user in (autoSignInAfterVerification).
    const session = await getSession()
    if (session?.user.emailVerified) redirect('/app')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {error ? 'Potvrda e-pošte nije uspjela' : 'Provjerite e-poštu'}
        </CardTitle>
        <CardDescription>
          {error
            ? 'Poveznica za potvrdu je nevažeća ili je istekla.'
            : 'Ako je adresa ispravna, poslali smo vam e-poruku za potvrdu. Poveznica vrijedi 1 sat.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <FormError message="Zatražite novu poruku za potvrdu." /> : null}
        <ResendVerificationForm />
        <p className="text-muted-foreground text-sm">
          Ako ste već potvrdili adresu,{' '}
          <Link href="/prijava" className="underline">
            prijavite se
          </Link>
          .
        </p>
        <Link href="/prijava" className="text-muted-foreground text-sm underline">
          Natrag na prijavu
        </Link>
      </CardContent>
    </Card>
  )
}
