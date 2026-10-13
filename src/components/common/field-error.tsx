export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
  )
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
    >
      {message}
    </p>
  )
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="bg-muted text-foreground rounded-lg border px-3 py-2 text-sm">
      {children}
    </p>
  )
}
