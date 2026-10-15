// Reads mail from the local catcher's HTTP API (scripts/mail/catcher.ts), the Mailpit stand-in.
import { expect } from '@playwright/test'

const MAIL_API = `http://127.0.0.1:${process.env.E2E_MAIL_HTTP_PORT ?? '1180'}/api/messages`

type Summary = { id: string; subject: string }
type Message = { id: string; subject: string; text: string | null; html: string | null }

/** Waits for a message to `to` whose subject contains `subject`, and returns it with its body. */
export async function waitForMail(to: string, subject: string): Promise<Message> {
  let found: Summary | undefined
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAIL_API}?to=${encodeURIComponent(to)}`)
        const list = (await res.json()) as Summary[]
        found = list.find((m) => m.subject.includes(subject))
        return found?.id
      },
      { message: `mail "${subject}" to ${to}`, timeout: 30_000 },
    )
    .toBeTruthy()
  const res = await fetch(`${MAIL_API}/${found!.id}`)
  return (await res.json()) as Message
}

/** The first URL in the mail text that contains `fragment`. */
export function linkIn(message: Message, fragment: string): string {
  const urls = (message.text ?? '').match(/https?:\/\/[^\s<>"]+/g) ?? []
  const url = urls.find((u) => u.includes(fragment))
  if (!url) throw new Error(`No link containing "${fragment}" in mail "${message.subject}"`)
  return url
}
