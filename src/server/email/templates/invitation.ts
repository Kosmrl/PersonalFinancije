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
      'Za prihvaćanje pozivnice potreban vam je račun s potvrđenom adresom e-pošte na koju je pozivnica poslana.',
    ],
    actionLabel: 'Otvori pozivnicu',
    actionUrl: input.url,
    footer: 'Ako ne očekujete ovu pozivnicu, zanemarite ovu poruku.',
  })
}
