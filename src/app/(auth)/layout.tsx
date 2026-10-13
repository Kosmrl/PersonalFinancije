export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <p className="text-center text-lg font-semibold tracking-tight">PersonalFinancije</p>
      {children}
    </main>
  )
}
