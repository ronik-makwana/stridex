import { env } from '../../../config/env.js'
import { button, escapeHtml, layout, textFooter, type RenderedMail } from './layout.js'

/**
 * The only template Phase 22 ships, and it is not throwaway: it is how anyone
 * proves the pipe works after a config change, on a new machine, or in a
 * staging environment where nothing else has been wired up yet.
 *
 * It deliberately exercises the awkward parts — an interpolated value that must
 * be escaped, an absolute link built from `STOREFRONT_URL`, and both body parts
 * — so that "the test email looked fine" means something.
 */
export type TestMailData = {
  /** Echoed back so a tester can tell one run from the next. */
  note: string
}

export function renderTestMail(data: TestMailData): RenderedMail {
  const link = `${env.STOREFRONT_URL}/`

  const body = `
      <p style="margin:0 0 16px">If you are reading this, the mail pipeline works end to end: enqueue, worker, provider, inbox.</p>
      <p style="margin:0 0 24px;color:#555555">Note: ${escapeHtml(data.note)}</p>
      <p style="margin:0 0 8px">${button(link, 'Open the storefront')}</p>`

  return {
    subject: 'StrideX mail test',
    html: layout({
      title: 'StrideX mail test',
      preheader: 'The mail pipeline works end to end.',
      body,
    }),
    text: `If you are reading this, the mail pipeline works end to end: enqueue, worker, provider, inbox.

Note: ${data.note}

Open the storefront: ${link}${textFooter()}`,
  }
}
