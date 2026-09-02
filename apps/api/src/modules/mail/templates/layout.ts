/**
 * The shell every email renders into, and the type that makes the plain-text
 * twin non-optional.
 *
 * **Both parts, always.** An HTML-only email scores badly with spam filters and
 * reads as a blank message in clients that prefer text — and retrofitting text
 * onto twenty templates is far harder than making the type demand it from the
 * first one. `RenderedMail` is what enforces that; nothing can be sent without
 * both.
 *
 * Inline styles and a table-free single column, because email clients are not
 * browsers: Outlook ignores <style> blocks, Gmail strips classes, and the
 * storefront's design tokens do not exist here. This is deliberately not the
 * editorial-minimal system from `apps/storefront` — it is the subset of HTML
 * that survives.
 */

export type RenderedMail = {
  subject: string
  html: string
  text: string
}

const BRAND = 'StrideX'

/** Escapes interpolated values. Every template goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:15px;font-weight:500">${escapeHtml(label)}</a>`
}

/**
 * Wraps body HTML in the shell. `preheader` is the grey line clients show next
 * to the subject in an inbox list; without one they show the first words of the
 * body, which is usually "View this email in your browser" or a bare greeting.
 */
export function layout(options: { title: string; preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title></head>
<body style="margin:0;padding:0;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111111">
  <span style="display:none;font-size:1px;color:#f6f6f4;max-height:0;overflow:hidden">${escapeHtml(options.preheader)}</span>
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-size:18px;font-weight:600;letter-spacing:-0.01em;padding-bottom:24px">${BRAND}</div>
    <div style="background:#ffffff;border-radius:6px;padding:32px;font-size:15px;line-height:1.6">
${options.body}
    </div>
    <div style="padding-top:24px;font-size:12px;line-height:1.6;color:#777777">
      ${BRAND} · This is an automated message; replies are not monitored.
    </div>
  </div>
</body>
</html>`
}

/** The plain-text footer, so the twin does not just stop mid-thought. */
export function textFooter(): string {
  return `\n\n—\n${BRAND}\nThis is an automated message; replies are not monitored.`
}
