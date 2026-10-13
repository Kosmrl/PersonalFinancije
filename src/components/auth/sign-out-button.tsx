'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function SignOutButton({ variant = 'outline' }: { variant?: 'outline' | 'ghost' }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    await authClient.signOut()
    router.replace('/prijava')
    router.refresh()
  }

  return (
    <Button type="button" variant={variant} disabled={pending} onClick={signOut}>
      {pending ? 'Odjava…' : 'Odjava'}
    </Button>
  )
}
