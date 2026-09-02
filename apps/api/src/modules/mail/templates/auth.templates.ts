import { env } from '../../../config/env.js'
import { button, escapeHtml, layout, textFooter, type RenderedMail } from './layout.js'

/**
 * The three account emails.
 *
 * These are the only templates whose data is **not** just ids: a raw token
 * cannot be re-read, because only its SHA-256 is stored. So the token travels
 * in the job payload and therefore sits in Redis for the life of the job —
 * which is why the mail queue discards completed jobs immediately and expires
 * failed ones after an hour. See `lib/queue.ts`.
 */

export type VerifyEmailData = { firstName: string | null; token: string; audience: 'shop' | 'admin' }
export type ResetPasswordData = { firstName: string | null; token: string; audience: 'shop' | 'admin' }
export type WelcomeData = { firstName: string | null }

/**
 * Admin and customer links go to different apps. Passing the audience rather
 * than guessing from the role keeps the decision at the call site, where it is
 * already known — and a reset link that lands a staff member on the storefront
 * login is a support ticket, not an error anyone would see in a log.
 */
const baseFor = (audience: 'shop' | 'admin') =>
  audience === 'admin' ? env.ADMIN_URL : env.STOREFRONT_URL

export function renderVerifyEmail(data: VerifyEmailData): RenderedMail {
  const name = data.firstName ?? 'there'
  /**
   * Top-level path, not `/auth/...`. Both SPAs mount their auth screens at the
   * root — `/verify-email`, `/reset-password` — under a chrome-free layout
   * rather than a URL prefix. Guessing the prefix produced a link that 404s,
   * which nothing in the API would ever have noticed.
   */
  const link = `${baseFor(data.audience)}/verify-email?token=${encodeURIComponent(data.token)}`

  return {
    subject: 'Confirm your email address',
    html: layout({
      title: 'Confirm your email address',
      preheader: 'One click and your StrideX account is confirmed.',
      body: `
      <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 24px">Confirm this address and your StrideX account is all set.</p>
      <p style="margin:0 0 24px">${button(link, 'Confirm my email')}</p>
      <p style="margin:0;color:#777777;font-size:13px">This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
    }),
    text: `Hi ${name},

Confirm this address and your StrideX account is all set:

${link}

This link expires in 24 hours. If you did not create an account, you can ignore this email.${textFooter()}`,
  }
}

export function renderResetPassword(data: ResetPasswordData): RenderedMail {
  const name = data.firstName ?? 'there'
  // Top-level, same as verification above.
  const link = `${baseFor(data.audience)}/reset-password?token=${encodeURIComponent(data.token)}`

  return {
    subject: 'Reset your password',
    html: layout({
      title: 'Reset your password',
      preheader: 'A link to set a new StrideX password.',
      body: `
      <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 24px">Use the link below to set a new password.</p>
      <p style="margin:0 0 24px">${button(link, 'Set a new password')}</p>
      <p style="margin:0;color:#777777;font-size:13px">If you did not ask for this, nothing has changed and you can ignore this email. Signing in again anywhere will not be affected.</p>`,
    }),
    text: `Hi ${name},

Use the link below to set a new password:

${link}

If you did not ask for this, nothing has changed and you can ignore this email.${textFooter()}`,
  }
}

export function renderWelcome(data: WelcomeData): RenderedMail {
  const name = data.firstName ?? 'there'
  const link = `${env.STOREFRONT_URL}/`

  return {
    subject: 'Welcome to StrideX',
    html: layout({
      title: 'Welcome to StrideX',
      preheader: 'Your email is confirmed. Here is where to start.',
      body: `
      <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 24px">Your email is confirmed and your account is ready. Your order history, saved addresses and wishlist all live in your account from here on.</p>
      <p style="margin:0 0 8px">${button(link, 'Start browsing')}</p>`,
    }),
    text: `Hi ${name},

Your email is confirmed and your account is ready. Your order history, saved addresses and wishlist all live in your account from here on.

Start browsing: ${link}${textFooter()}`,
  }
}
