import type { Metadata } from 'next'
import Link from 'next/link'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Zaboravljena lozinka' }

export default function ZaboravljenaLozinkaPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Zaboravljena lozinka</CardTitle>
        <CardDescription>
          Upišite adresu e-pošte i poslat ćemo vam poveznicu za odabir nove lozinke.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ForgotPasswordForm />
        <Link href="/prijava" className="text-muted-foreground text-sm underline">
          Natrag na prijavu
        </Link>
      </CardContent>
    </Card>
  )
}
