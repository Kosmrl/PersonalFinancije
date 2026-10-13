import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

// latin-ext is required for Croatian diacritics (č, ć, đ, š, ž).
const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'PersonalFinancije',
  description: 'Izdavanje računa i knjigovodstvo za paušalne obrtnike.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hr" className={cn('font-sans', geist.variable)}>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster richColors />
      </body>
    </html>
  )
}
