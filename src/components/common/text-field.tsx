import { FieldError } from '@/components/common/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = Omit<React.ComponentProps<typeof Input>, 'id' | 'name'> & {
  name: string
  label: string
  error?: string
  hint?: React.ReactNode
}

export function TextField({ name, label, error, hint, className, ...props }: Props) {
  const id = `field-${name}`
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}
