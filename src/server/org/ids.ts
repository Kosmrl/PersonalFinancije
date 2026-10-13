import 'server-only'
import { randomInt } from 'node:crypto'

// Ids for rows in Better Auth's tables that the app writes itself (invitations). Same shape as
// Better Auth's default generateId: 32 characters from [A-Za-z0-9] (what the audit log's AUTH_ID
// check and the invitation URL expect), here from the CSPRNG. An all-digit id is rejected by the
// audit allowlist (it could be mistaken for an OIB), so one is never returned.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function newAuthId(): string {
  for (;;) {
    let id = ''
    for (let i = 0; i < 32; i++) id += ALPHABET[randomInt(ALPHABET.length)]
    if (!/^\d+$/.test(id)) return id
  }
}
