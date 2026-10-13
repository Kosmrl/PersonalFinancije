import 'server-only'
import { betterAuth } from 'better-auth'
import { createEmailVerificationToken } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { organization, twoFactor } from 'better-auth/plugins'
import { getDb } from '@/server/db/client'
import * as schema from '@/server/db/schema'
import { sendMail } from '@/server/email/transport'
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

    // HTTP-level blocks (404) only: the router checks this list for incoming requests, while
    // server-side auth.api.* calls are not affected. EVERY /organization/* route is closed: writes
    // would skip authorization, last-owner serialization and the audit row (review item S4), and
    // reads (check-slug, get-full-organization, list-members, ...) are slug/membership oracles
    // (review item N1). The app reads this data itself (src/server/org/queries.ts) and uses no
    // authClient.organization.* call. A test enumerates the plugin's endpoints and fails when a new
    // /organization/* path is not listed here (tests/integration/org-actions.test.ts).
    disabledPaths: [
      '/organization/accept-invitation',
      '/organization/add-team-member',
      '/organization/cancel-invitation',
      '/organization/check-slug',
      '/organization/create',
      '/organization/create-role',
      '/organization/create-team',
      '/organization/delete',
      '/organization/delete-role',
      '/organization/get-active-member',
      '/organization/get-active-member-role',
      '/organization/get-full-organization',
      '/organization/get-invitation',
      '/organization/get-organization',
      '/organization/get-role',
      '/organization/has-permission',
      '/organization/invite-member',
      '/organization/leave',
      '/organization/list',
      '/organization/list-invitations',
      '/organization/list-members',
      '/organization/list-roles',
      '/organization/list-team-members',
      '/organization/list-teams',
      '/organization/list-user-invitations',
      '/organization/list-user-teams',
      '/organization/reject-invitation',
      '/organization/remove-member',
      '/organization/remove-team',
      '/organization/remove-team-member',
      '/organization/set-active',
      '/organization/set-active-team',
      '/organization/update',
      '/organization/update-member-role',
      '/organization/update-role',
      '/organization/update-team',
    ],

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
        // No sendInvitationEmail: Better Auth's invitation endpoints are disabled; the
        // inviteMember action (server/org/actions.ts) writes the row and sends the email itself.
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
