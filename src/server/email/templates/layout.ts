import 'server-only'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export type Template = { subject: string; text: string; html: string }

// One call-to-action message: paragraphs, a button-like link, and a footer line.
export function actionEmail(options: {
  subject: string
  heading: string
  paragraphs: string[]
  actionLabel: string
  actionUrl: string
  footer: string
}): Template {
  const { subject, heading, paragraphs, actionLabel, actionUrl, footer } = options
  const text = [heading, '', ...paragraphs, '', `${actionLabel}: ${actionUrl}`, '', footer].join(
    '\n',
  )
  const html = `<!doctype html>
<html lang="hr"><body style="font-family:Arial,Helvetica,sans-serif;color:#171717;line-height:1.5">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#171717;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(actionLabel)}</a></p>
<p style="font-size:13px;color:#525252">Ako gumb ne radi, kopirajte ovu poveznicu u preglednik:<br>${escapeHtml(actionUrl)}</p>
<p style="font-size:13px;color:#525252">${escapeHtml(footer)}</p>
</body></html>`
  return { subject, text, html }
}
