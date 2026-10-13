import 'server-only'
import type { InvitationView } from './queries'

// Croatian texts for the invitation states, shared by the action results and the invitation page.
// None of them names the invited address or the obrt.

export const LAST_OWNER_MESSAGE = 'Obrt mora imati barem jednog vlasnika.'

export const PROFILE_FIRST_MESSAGE =
  'Najprije dovršite unos podataka o obrtu (Podaci o obrtu), zatim upravljajte članovima.'

export const INVITATION_MESSAGES: Record<Exclude<InvitationView['state'], 'open'>, string> = {
  unavailable: 'Pozivnica ne postoji ili više nije važeća.',
  wrong_recipient: 'Pozivnica je poslana na drugu adresu.',
  expired: 'Pozivnica je istekla. Zatražite novu od vlasnika obrta.',
  revoked: 'Pozivnica je opozvana.',
  used: 'Pozivnica je već iskorištena.',
  declined: 'Pozivnica je odbijena.',
  already_member: 'Već ste član ovog obrta.',
}
