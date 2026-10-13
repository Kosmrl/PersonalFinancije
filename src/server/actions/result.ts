import 'server-only'

// Shared server-action contract (plan: "Shared contract for every server action"). Messages are
// Croatian; no stack traces, SQL errors or other internals ever reach the client.

export type ActionFailure = {
  ok: false
  message: string
  fieldErrors?: Record<string, string>
}

export type ActionResult<T> = { ok: true; data: T } | ActionFailure

export const FORBIDDEN_MESSAGE = 'Nemate ovlasti za ovu radnju.'
export const GENERIC_ERROR_MESSAGE = 'Došlo je do pogreške. Pokušajte ponovno.'

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

export function fail(message: string, fieldErrors?: Record<string, string>): ActionFailure {
  return fieldErrors ? { ok: false, message, fieldErrors } : { ok: false, message }
}

export function forbidden(): ActionFailure {
  return fail(FORBIDDEN_MESSAGE)
}
