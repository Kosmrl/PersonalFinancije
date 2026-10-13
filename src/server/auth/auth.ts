import 'server-only'
import { betterAuth } from 'better-auth'
import { createEmailVerificationToken } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { organization, twoFactor } from 'better-auth/plugins'
import { getDb } from '@/server/db/client'
import * as schema from '@/server/db/schema'
import { sendMail } from '@/server/email/transport'
import { invitationTemplate } from '@/server/email/templates/invitation'
import {
  existingAccountTemplate,
  resetPasswordTemplate,
} from '@/server/email/templates/reset-password'
import { verifyEmailTemplate } from '@/server/email/templates/verify-email'
import { getAuthEnv } from '@/server/env'
import { log } from '@/server/log'
import { ac, roles } from './permissions'

// Better Auth 1.7.x. Option names verified against the installed type definitions
// (@better-auth/core init-options, plugins/organization/types).
//
// Created lazily (getAuth) so that importing this module, for example during `next build`,
// needs neither DATABASE_URL nor the auth secrets.

function createAuth() {
  const env = getAuthEnv()
  const baseUrl = env.BETTER_AUTH_URL
  const appName = env.APP_NAME

  return betterAuth({
    appName,
    baseURL: baseUrl,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseUrl, ...(env.TRUSTED_ORIGINS ?? [])],

    // Better Auth runs on the same runtime pf_app pool as the app. The auth tables (user, session,
    // account, organization, member, ...) have no row-level security; tenant isolation applies to
    // the application tables. Text ids are Better Auth's default. `transaction: true` makes
    // multi-step operations (sign-up, organization creation with its owner member) atomic.
    database: drizzleAdapter(getDb(), { provider: 'pg', schema, transaction: true }),

    // HTTP-level blocks only; server-side auth.api.createOrganization stays available.
    // Organizations are created by the app (step 6) and never deleted (retention).
    // TODO(step 6): decide on the member and invitation paths.
    disabledPaths: ['/organization/create', '/organization/delete'],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      // Sign-up with an address that already has an account returns the same response as a new
      // one (requireEmailVerification), and the owner of that address is told by email instead.
      // If that account never verified its address, the verification email is sent again.
      onExistingUserSignUp: async ({ user }) => {
        if (!user.emailVerified) {
          // Built here rather than through auth.api: this hook runs inside the sign-up
          // transaction's async context, where an api call could use a released connection.
          const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, user.email)
          const url =
            `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}` +
            `&callbackURL=${encodeURIComponent('/potvrda-emaila')}`
          await sendMail({ to: user.email, ...verifyEmailTemplate({ appName, url }) })
          return
        }
        const template = existingAccountTemplate({
          appName,
          url: `${baseUrl}/zaboravljena-lozinka`,
        })
        await sendMail({ to: user.email, ...template })
      },
      sendResetPassword: async ({ user, url }) => {
        await sendMail({ to: user.email, ...resetPasswordTemplate({ appName, url }) })
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({ to: user.email, ...verifyEmailTemplate({ appName, url }) })
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refreshed at most once a day
    },

    // Per-IP limits on the auth endpoints, stored in the `rateLimit` table so they hold across
    // server instances. Better Auth's defaults are stricter on sign-in, sign-up and password
    // reset than the general limit.
    // TODO(deployment): behind a reverse proxy, configure advanced.ipAddress.ipAddressHeaders
    // (and trusted proxies) before deployment, or every client shares one bucket.
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },

    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      // Run email sending in the background without awaiting it, so response time does not reveal
      // whether an address has an account (password reset). Better Auth still catches a rejected
      // promise and logs it through `logger` below (runInBackgroundOrAwait).
      backgroundTasks: {
        handler: (promise) => {
          void promise
        },
      },
    },

    // Better Auth logs some messages with email addresses (for example on a repeated sign-up).
    // Only warnings and errors are forwarded, through the redacting logger.
    logger: {
      level: 'warn',
      // The first extra argument (usually the error) goes through the scrubbing logger.
      log: (level, message, ...args) => {
        if (level === 'error') log.error(message, { error: args[0] })
        else log.warn(message, { detail: args[0] })
      },
    },

    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        // Deleting an organization would cascade-delete invoices; retention forbids it, and the
        // delete hooks are not atomic with the cascade.
        disableOrganizationDeletion: true,
        // The invitation page requires a verified email, so the invited address is proven.
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async (data) => {
          await sendMail({
            to: data.email,
            ...invitationTemplate({
              appName,
              organizationName: data.organization.name,
              role: data.role,
              url: `${baseUrl}/pozivnica/${data.id}`,
            }),
          })
        },
      }),
      twoFactor({ issuer: appName }),
      // Must be the last plugin: it sets cookies from server actions.
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

const globalForAuth = globalThis as unknown as { pfAuth?: Auth }

export function getAuth(): Auth {
  globalForAuth.pfAuth ??= createAuth()
  return globalForAuth.pfAuth
}
