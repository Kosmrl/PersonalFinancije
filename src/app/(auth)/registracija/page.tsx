import type { Metadata } from 'next'
import Link from 'next/link'
import { SignUpForm } from '@/components/auth/sign-up-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Registracija' }

export default function RegistracijaPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Registracija</CardTitle>
        <CardDescription>Otvorite račun za svoj obrt.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SignUpForm />
        <p className="text-muted-foreground text-sm">
          Već imate račun?{' '}
          <Link href="/prijava" className="text-foreground underline">
            Prijavite se
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
