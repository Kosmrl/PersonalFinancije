export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
      <p className="text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}
