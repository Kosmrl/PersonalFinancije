import 'server-only'
import { z } from 'zod'

// Empty strings (`SMTP_USER=` in .env files) count as "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ })

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('PersonalFinancije'),

  // Runtime role pf_app (NOSUPERUSER NOBYPASSRLS).
  DATABASE_URL: postgresUrl,
  // Schema owner pf_owner. Only migration tooling needs it; the app never connects with it.
  DATABASE_MIGRATION_URL: optional(postgresUrl),

  // Required from build-sequence step 4 (Better Auth); optional until then.
  BETTER_AUTH_SECRET: optional(z.string().min(32)),
  BETTER_AUTH_URL: optional(z.url()),
  TRUSTED_ORIGINS: optional(
    z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),
  ),

  // Mail transport (step 4): the local catcher in development, SMTP in production.
  SMTP_HOST: optional(z.string().min(1)),
  // A TCP port, kept as a decimal string (nodemailer accepts one). Validated without turning it
  // into a JS number: 1-65535 means 1 to 5 digits, no leading zero, and not above "65535" once
  // both sides are padded to five digits (same-length digit strings compare like numbers).
  SMTP_PORT: optional(
    z
      .string()
      .regex(/^[1-9]\d{0,4}$/, 'must be a port number from 1 to 65535')
      .refine((port) => port.padStart(5, '0') <= '65535', 'must be a port number from 1 to 65535'),
  ),
  SMTP_USER: optional(z.string().min(1)),
  SMTP_PASS: optional(z.string().min(1)),
  MAIL_FROM: optional(z.string().min(1)),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

/**
 * Validated environment, parsed on first use rather than at import time so that
 * `next build` does not need runtime secrets. Throws a message that names the failing
 * variables but never echoes their values.
 */
export function getEnv(): Env {
  if (cached) return cached
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid environment configuration: ${problems}`)
  }
  cached = result.data
  return cached
}
