import type { Metadata } from 'next'
import { TwoFactorForm } from '@/components/auth/two-factor-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Dvofaktorska prijava' }

export default function DvofaktorskaPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Dvofaktorska prijava</CardTitle>
        <CardDescription>
          Unesite šesteroznamenkasti kod iz aplikacije za provjeru ili pričuvni kod.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorForm />
      </CardContent>
    </Card>
  )
}
