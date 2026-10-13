import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { getAuthEnv } from '@/server/env'
import { log } from '@/server/log'

// SMTP delivery: the local mail catcher in development (`npm run mail`), SES SMTP or similar later.
// Message contents (links with tokens) and recipient addresses are never logged.

export type Mail = { to: string; subject: string; text: string; html: string }

const globalForMail = globalThis as unknown as { pfMailer?: Transporter }

function getTransporter(): Transporter {
  if (!globalForMail.pfMailer) {
    const env = getAuthEnv()
    globalForMail.pfMailer = nodemailer.createTransport({
      host: env.SMTP_HOST,
      // Not money: a TCP port, already validated as 1-65535 by env.ts.
      // eslint-disable-next-line no-restricted-syntax
      port: env.SMTP_PORT ? Number.parseInt(env.SMTP_PORT, 10) : 1025,
      // Port 465 is implicit TLS; everything else upgrades with STARTTLS when offered. The local
      // catcher speaks plain SMTP.
      secure: env.SMTP_PORT === '465',
      // In production, never fall back to plain SMTP if STARTTLS is not offered.
      ...(env.NODE_ENV === 'production' ? { requireTLS: true } : {}),
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    })
  }
  return globalForMail.pfMailer
}

export async function sendMail(mail: Mail): Promise<void> {
  try {
    await getTransporter().sendMail({
      from: getAuthEnv().MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
  } catch (error) {
    log.error('email delivery failed', { error })
    throw error
  }
}
