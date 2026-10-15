import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main
      className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10"
      aria-busy="true"
      aria-label="Učitavanje"
    >
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full" />
    </main>
  )
}
