import 'server-only'
import { actionEmail } from './layout'

const ROLE_LABELS: Record<string, string> = {
  owner: 'vlasnik',
  accountant: 'knjigovođa',
  member: 'član',
}

export function invitationTemplate(input: {
  appName: string
  organizationName: string
  role: string
  url: string
}) {
  const role = ROLE_LABELS[input.role] ?? input.role
  return actionEmail({
    subject: `Pozivnica za ${input.organizationName} (${input.appName})`,
    heading: 'Pozvani ste u obrt',
    paragraphs: [
      `Pozvani ste da se pridružite obrtu ${input.organizationName} u aplikaciji ${input.appName} kao ${role}.`,
      'Za prihvaćanje pozivnice prijavite se računom čija je adresa e-pošte potvrđena, a to je adresa na koju je pozivnica poslana. Ako još nemate račun, otvorite ga s tom adresom.',
    ],
    actionLabel: 'Otvori pozivnicu',
    actionUrl: input.url,
    footer: 'Ako ne očekujete ovu pozivnicu, zanemarite ovu poruku.',
  })
}
