import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-3 px-4 py-10">
      <h1 className="text-xl font-semibold">Stranica ne postoji ili nemate pristup.</h1>
      <Link href="/app" className="underline">
        Natrag na početnu
      </Link>
    </main>
  )
}
