import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '@/components/auth/sign-in-form'
import { FormNotice } from '@/components/common/field-error'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Prijava' }

type SearchParams = Promise<{ next?: string | string[]; lozinka?: string | string[] }>

export default async function PrijavaPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, lozinka } = await searchParams
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Prijava</CardTitle>
        <CardDescription>Prijavite se u svoj račun.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {lozinka === 'promijenjena' ? (
          <FormNotice>Lozinka je promijenjena. Prijavite se novom lozinkom.</FormNotice>
        ) : null}
        <SignInForm next={typeof next === 'string' ? next : undefined} />
        <p className="text-muted-foreground text-sm">
          Nemate račun?{' '}
          <Link href="/registracija" className="text-foreground underline">
            Registrirajte se
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
