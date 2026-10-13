import { redirect } from 'next/navigation'

// /app sends visitors without a session to the sign-in page (proxy.ts and requireUser).
export default function HomePage() {
  redirect('/app')
}
