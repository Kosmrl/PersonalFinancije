import 'server-only'
import { actionEmail } from './layout'

export function resetPasswordTemplate(input: { appName: string; url: string }) {
  return actionEmail({
    subject: `Postavljanje nove lozinke (${input.appName})`,
    heading: 'Postavite novu lozinku',
    paragraphs: [
      `Zaprimili smo zahtjev za promjenu lozinke za vaš račun u aplikaciji ${input.appName}.`,
      'Kliknite gumb u nastavku kako biste odabrali novu lozinku. Poveznica vrijedi 1 sat i može se iskoristiti samo jednom.',
    ],
    actionLabel: 'Postavi novu lozinku',
    actionUrl: input.url,
    footer:
      'Ako niste zatražili promjenu lozinke, zanemarite ovu poruku. Vaša lozinka ostaje nepromijenjena.',
  })
}

// Sent when someone tries to register with an address that already has an account, so the
// registration form can show the same neutral message for every address (anti-enumeration).
export function existingAccountTemplate(input: { appName: string; url: string }) {
  return actionEmail({
    subject: `Pokušaj registracije (${input.appName})`,
    heading: 'Već imate račun',
    paragraphs: [
      `Netko je pokušao registrirati račun u aplikaciji ${input.appName} s ovom adresom e-pošte, a račun već postoji.`,
      'Ako ste to bili vi, prijavite se postojećim računom. Ako ste zaboravili lozinku, možete je postaviti ponovno.',
    ],
    actionLabel: 'Postavi novu lozinku',
    actionUrl: input.url,
    footer: 'Ako to niste bili vi, nije potrebna nikakva radnja.',
  })
}
