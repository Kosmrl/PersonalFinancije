import { Button } from '@/components/ui/button'

type Props = Omit<React.ComponentProps<typeof Button>, 'type' | 'disabled'> & {
  pending: boolean
  pendingLabel?: string
}

// Pending state per the plan: the label changes to "Spremanje…" and the button is disabled.
export function SubmitButton({ pending, pendingLabel = 'Spremanje…', children, ...props }: Props) {
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  )
}
