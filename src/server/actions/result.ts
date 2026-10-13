import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { log } from '@/server/log'
import type { AuditAction } from '@/server/audit/record'

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

/**
 * Wraps the body of a server action so nothing unexpected reaches the client or the log
 * unredacted. Every action returns through it.
 *
 * - redirect(), notFound() and the other Next control-flow errors are rethrown untouched
 *   (unstable_rethrow), so they keep working inside `fn`.
 * - Anything else is logged through the redacted logger (class name and error code only: a
 *   drizzle-orm DrizzleQueryError message carries the bind parameters, i.e. personal data) and
 *   becomes the generic Croatian failure result.
 *
 * `name` identifies the action in the log. It is typed as an audit action name or one of
 * AuthActionName, so only constants compile; extend those unions for new actions.
 */
export type AuthActionName =
  | 'auth.sign_up'
  | 'auth.sign_in'
  | 'auth.verify_email'
  | 'auth.reset_password'
  | 'auth.two_factor'
export type ActionName = AuditAction | AuthActionName

export async function runAction<T>(
  name: ActionName,
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn()
  } catch (error) {
    unstable_rethrow(error)
    log.error('server action failed', { action: name, error })
    return fail(GENERIC_ERROR_MESSAGE)
  }
}
