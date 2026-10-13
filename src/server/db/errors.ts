// Reading database errors without leaking their contents.
//
// drizzle-orm wraps every driver failure in a DrizzleQueryError whose message is
// `Failed query: <sql> params: <bind values>`: the bind values are customer names, OIBs and
// IBANs. The driver's own error (with the SQLSTATE in `.code`) is in `.cause`. Nothing here
// returns or logs a message, a query or parameters; only codes and constraint names, which are
// part of our schema.

const MAX_CAUSE_DEPTH = 8

// A SQLSTATE is five characters of digits and capital letters (23505, 42501, 428C9). Node
// system errors (ECONNREFUSED) and library codes do not have that shape.
const SQLSTATE = /^[0-9A-Z]{5}$/

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === 'object'; depth++) {
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

/** The first string `code` along the `.cause` chain (SQLSTATE or a Node system code), if any. */
export function errorCode(error: unknown): string | undefined {
  for (const node of causeChain(error)) {
    const code = (node as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

function findPgError(error: unknown): { code: string; constraint?: string } | undefined {
  for (const node of causeChain(error)) {
    const { code, constraint } = node as { code?: unknown; constraint?: unknown }
    if (typeof code === 'string' && SQLSTATE.test(code)) {
      return { code, ...(typeof constraint === 'string' ? { constraint } : {}) }
    }
  }
  return undefined
}

/** The SQLSTATE of a failed query, found by walking `.cause`; never a message or parameter. */
export function pgErrorCode(error: unknown): string | undefined {
  return findPgError(error)?.code
}

function isViolation(code: string, error: unknown, constraintName?: string): boolean {
  const found = findPgError(error)
  if (found?.code !== code) return false
  return constraintName === undefined || found.constraint === constraintName
}

/** 23505. Pass the constraint or index name to tell apart several unique rules on one table. */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  return isViolation('23505', error, constraintName)
}

/** 23503. */
export function isForeignKeyViolation(error: unknown, constraintName?: string): boolean {
  return isViolation('23503', error, constraintName)
}

/** 23514. */
export function isCheckViolation(error: unknown, constraintName?: string): boolean {
  return isViolation('23514', error, constraintName)
}
