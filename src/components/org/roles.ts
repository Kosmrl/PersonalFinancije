export const ROLE_LABELS: Record<string, string> = {
  owner: 'Vlasnik',
  accountant: 'Knjigovođa',
  member: 'Član',
}

export function roleLabel(role: string | null): string {
  if (!role) return '-'
  const first = role.split(',')[0]?.trim() ?? role
  return ROLE_LABELS[first] ?? first
}
