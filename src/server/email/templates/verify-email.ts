import 'server-only'
import { actionEmail } from './layout'

export function verifyEmailTemplate(input: { appName: string; url: string }) {
  return actionEmail({
    subject: `Potvrdite svoju e-poštu (${input.appName})`,
    heading: 'Potvrdite svoju e-poštu',
    paragraphs: [
      `Hvala što ste se registrirali u aplikaciji ${input.appName}.`,
      'Kliknite gumb u nastavku kako biste potvrdili adresu e-pošte. Poveznica vrijedi 1 sat.',
    ],
    actionLabel: 'Potvrdi e-poštu',
    actionUrl: input.url,
    footer: 'Ako se niste registrirali, slobodno zanemarite ovu poruku.',
  })
}
