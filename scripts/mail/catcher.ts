// A minimal local mail catcher: an SMTP server that keeps every message in memory, plus a small
// HTTP API and web page to read them. Used by `npm run mail` for auth emails (verification, password
// reset, invitations) during development, and by Playwright e2e later.
//
// Why not maildev: see the build-sequence step 2 report. maildev 3.0.0 pulls a nodemailer with
// open high-severity advisories through @maildev/smtp; smtp-server + mailparser resolve to patched
// versions. Why not Mailpit: it is a Go binary and this machine has no Docker or system installs.
//
// Dev tooling only. It binds to loopback, accepts any sender and any (or no) credentials,
// and keeps at most MAX_MESSAGES messages of at most MAX_MESSAGE_BYTES each, forgotten on restart.
// The HTTP side answers only to Host: 127.0.0.1:<port> or localhost:<port> (DNS-rebinding guard).
//
// HTTP API (JSON):
//   GET    /api/messages[?to=addr]   newest first: id, subject, from, to, receivedAt, no bodies
//   GET    /api/messages/:id         one message with text, html, headers, attachments (metadata)
//   DELETE /api/messages             forget all messages
//   GET    /                         human-readable inbox

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Server as NetServer } from 'node:net'
import type { AddressObject, ParsedMail } from 'mailparser'
import { simpleParser } from 'mailparser'
import { SMTPServer } from 'smtp-server'

const MAX_MESSAGES = 100
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024

export type Address = { name: string; address: string }

export type CaughtMessage = {
  id: string
  receivedAt: string
  /** SMTP envelope, which is what routing used (Bcc recipients appear only here). */
  envelope: { from: string | false; to: string[] }
  subject: string
  from: Address[]
  to: Address[]
  cc: Address[]
  date: string | null
  text: string | null
  html: string | null
  headers: Record<string, string>
  attachments: { filename: string | null; contentType: string; size: number }[]
}

export type MessageSummary = Pick<
  CaughtMessage,
  'id' | 'receivedAt' | 'subject' | 'from' | 'to' | 'envelope'
>

function addresses(field: AddressObject | AddressObject[] | undefined): Address[] {
  const list = Array.isArray(field) ? field : field ? [field] : []
  return list.flatMap((entry) =>
    entry.value.map((v) => ({ name: v.name ?? '', address: v.address ?? '' })),
  )
}

function headerValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'text' in value)
    return String((value as { text: unknown }).text)
  return JSON.stringify(value)
}

function toMessage(parsed: ParsedMail, envelope: CaughtMessage['envelope']): CaughtMessage {
  return {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    envelope,
    subject: parsed.subject ?? '',
    from: addresses(parsed.from),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    date: parsed.date ? parsed.date.toISOString() : null,
    text: parsed.text ?? null,
    html: parsed.html === false ? null : parsed.html,
    headers: Object.fromEntries(
      [...parsed.headers].map(([key, value]) => [key, headerValue(value)]),
    ),
    attachments: parsed.attachments.map((a) => ({
      filename: a.filename ?? null,
      contentType: a.contentType,
      size: a.size,
    })),
  }
}

const INBOX_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mail catcher</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 22rem 1fr; height: 100vh; }
  #list { overflow: auto; border-right: 1px solid #8884; }
  #list button { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #8882; padding: .6rem .8rem; background: none; color: inherit; font: inherit; cursor: pointer; }
  #list button:hover, #list button.active { background: #8882; }
  #list small { display: block; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #view { overflow: auto; padding: 1rem; }
  pre { white-space: pre-wrap; word-break: break-word; }
  iframe { width: 100%; height: 28rem; border: 1px solid #8884; background: #fff; }
  header { display: flex; gap: .5rem; align-items: center; padding: .6rem .8rem; border-bottom: 1px solid #8884; }
</style></head><body>
<div><header><strong>Mail catcher</strong><button id="clear">Clear</button></header><div id="list"></div></div>
<main id="view"><p>No message selected.</p></main>
<script>
  const list = document.getElementById('list'), view = document.getElementById('view');
  let selected = null, lastIds = '';
  const fmt = (a) => a.map((x) => x.address).join(', ');
  async function refresh() {
    const res = await fetch('/api/messages'); const items = await res.json();
    const ids = items.map((m) => m.id).join();
    if (ids === lastIds) return; lastIds = ids;
    list.replaceChildren(...items.map((m) => {
      const b = document.createElement('button');
      if (m.id === selected) b.className = 'active';
      const s = document.createElement('strong'); s.textContent = m.subject || '(no subject)';
      const t = document.createElement('small'); t.textContent = 'To: ' + (fmt(m.to) || m.envelope.to.join(', '));
      const d = document.createElement('small'); d.textContent = new Date(m.receivedAt).toLocaleString();
      b.append(s, t, d); b.onclick = () => show(m.id); return b;
    }));
  }
  async function show(id) {
    selected = id; lastIds = '';
    const m = await (await fetch('/api/messages/' + id)).json();
    const h = document.createElement('h2'); h.textContent = m.subject || '(no subject)';
    const meta = document.createElement('p');
    meta.textContent = 'From: ' + fmt(m.from) + '  To: ' + fmt(m.to) + '  Envelope to: ' + m.envelope.to.join(', ');
    const nodes = [h, meta];
    if (m.html) {
      // No allow-scripts: mail HTML can never run code. Popups are allowed so links open in a new tab.
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      const base = '<base target="_blank">';
      f.srcdoc = /<head(?![a-z])[^>]*>/i.test(m.html) ? m.html.replace(/<head(?![a-z])[^>]*>/i, (h) => h + base) : base + m.html;
      nodes.push(f);
    }
    const pre = document.createElement('pre'); pre.textContent = m.text || ''; nodes.push(pre);
    view.replaceChildren(...nodes); refresh();
  }
  document.getElementById('clear').onclick = async () => { await fetch('/api/messages', { method: 'DELETE' }); selected = null; lastIds = ''; view.textContent = 'No message selected.'; refresh(); };
  refresh(); setInterval(refresh, 2000);
</script></body></html>`

export type MailCatcher = {
  smtpPort: number
  httpPort: number
  /** The in-memory store, newest last. Exposed for in-process use in tests. */
  messages: CaughtMessage[]
  close(): Promise<void>
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function handleHttp(
  messages: CaughtMessage[],
  allowedHosts: string[],
  req: IncomingMessage,
  res: ServerResponse,
): void {
  // The API serves email bodies (verification links, reset tokens). Refusing any other Host
  // header stops a web page from reading them through DNS rebinding.
  const host = req.headers.host?.toLowerCase()
  if (!host || !allowedHosts.includes(host)) {
    return json(res, 403, { error: 'forbidden host' })
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-frame-options': 'DENY',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-src about:; frame-ancestors 'none'",
    })
    res.end(INBOX_PAGE)
    return
  }

  if (path === '/api/messages') {
    if (req.method === 'GET') {
      const to = url.searchParams.get('to')?.toLowerCase()
      const summaries: MessageSummary[] = messages
        .filter(
          (m) =>
            !to ||
            m.to.some((a) => a.address.toLowerCase() === to) ||
            m.envelope.to.some((a) => a.toLowerCase() === to),
        )
        .map(({ id, receivedAt, subject, from, to: recipients, envelope }) => ({
          id,
          receivedAt,
          subject,
          from,
          to: recipients,
          envelope,
        }))
        .reverse()
      return json(res, 200, summaries)
    }
    if (req.method === 'DELETE') {
      messages.length = 0
      res.writeHead(204).end()
      return
    }
    return json(res, 405, { error: 'method not allowed' })
  }

  const match = /^\/api\/messages\/([^/]+)$/.exec(path)
  if (match) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
    const message = messages.find((m) => m.id === match[1])
    return message ? json(res, 200, message) : json(res, 404, { error: 'not found' })
  }

  json(res, 404, { error: 'not found' })
}

type Listenable = {
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
  listen(port: number, host: string, callback: () => void): unknown
}

export async function startMailCatcher(
  opts: { smtpPort?: number; httpPort?: number; host?: string } = {},
): Promise<MailCatcher> {
  const host = opts.host ?? '127.0.0.1'
  const messages: CaughtMessage[] = []
  let started = false

  const smtp = new SMTPServer({
    authOptional: true,
    // Accept any credentials: the app sends with or without SMTP_USER/SMTP_PASS.
    onAuth: (_auth, _session, callback) => callback(null, { user: 'catcher' }),
    // Plain SMTP only; nothing here is worth encrypting on loopback.
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    // Announced in EHLO and enforced on MAIL FROM SIZE=..., so well-behaved clients are
    // refused before they send the body.
    size: MAX_MESSAGE_BYTES,
    logger: false,
    onData(stream, session, callback) {
      // Buffer the message ourselves so an oversized one is dropped as it arrives, not parsed.
      const chunks: Buffer[] = []
      let total = 0
      let tooLarge = false
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_MESSAGE_BYTES) {
          tooLarge = true
          chunks.length = 0
        } else if (!tooLarge) {
          chunks.push(chunk)
        }
      })
      stream.once('error', (error) => callback(error))
      stream.once('end', () => {
        if (tooLarge || stream.sizeExceeded) {
          return callback(Object.assign(new Error('Message too large'), { responseCode: 552 }))
        }
        simpleParser(Buffer.concat(chunks))
          .then((parsed) => {
            messages.push(
              toMessage(parsed, {
                from: session.envelope.mailFrom ? session.envelope.mailFrom.address : false,
                to: session.envelope.rcptTo.map((r) => r.address),
              }),
            )
            if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES)
            callback()
          })
          .catch((error: unknown) =>
            callback(error instanceof Error ? error : new Error('parse failed')),
          )
      })
    },
  })
  // Without a listener an 'error' event (a client resetting the connection mid-session, say)
  // would crash the process. Startup errors are reported by listen() below instead.
  smtp.on('error', (error) => {
    if (started) console.error('SMTP:', error.message)
  })

  const http: Server = createServer((req, res) => {
    try {
      const port = (http.address() as { port: number } | null)?.port
      handleHttp(messages, [`127.0.0.1:${port}`, `localhost:${port}`], req, res)
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'internal error' })
      else res.end()
    }
  })
  http.on('error', (error) => {
    if (started) console.error('HTTP:', error.message)
  })
  http.on('clientError', (_error, socket) => socket.destroy())

  const listen = (server: Listenable, port: number, name: string) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', (e) =>
        reject(
          new Error(
            e.code === 'EADDRINUSE'
              ? `${name} port ${port} is already in use. Is another mail catcher running?`
              : e.message,
          ),
        ),
      )
      server.listen(port, host, resolve)
    })

  await listen(smtp, opts.smtpPort ?? 1025, 'SMTP')
  try {
    await listen(http, opts.httpPort ?? 1080, 'HTTP')
  } catch (error) {
    smtp.close()
    throw error
  }
  started = true

  const addr = (server: NetServer) => (server.address() as { port: number }).port
  return {
    smtpPort: addr(smtp.server),
    httpPort: addr(http),
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections()
        http.close(() => smtp.close(() => resolve()))
      }),
  }
}
