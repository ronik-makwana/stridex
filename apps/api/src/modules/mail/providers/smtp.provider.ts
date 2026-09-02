import nodemailer, { type Transporter } from 'nodemailer'
import { env, isProduction } from '../../../config/env.js'
import { logger } from '../../../lib/logger.js'
import type { MailMessage, MailProvider, SentMail } from './provider.types.js'

/**
 * SMTP, which is the same protocol in development and production — mailpit on
 * localhost:1025 now, SES or Resend later. One implementation covers both,
 * which is why there is no third provider for "real" mail.
 *
 * An API-based provider (Resend's REST API, say) is still worth having
 * eventually, because it is how you receive bounce and complaint webhooks. That
 * is a Phase 23+ concern and it drops in behind `MailProvider` when it matters.
 */

let transporter: Transporter | undefined

/**
 * Lazily built, and reused. A transport opens a connection pool, so
 * constructing one per message would give every email a fresh TCP and TLS
 * handshake — and importing this module would connect to SMTP even in a process
 * that never sends anything.
 */
function getTransporter(): Transporter {
  if (transporter) return transporter

  /**
   * 465 is implicit TLS (Resend); 587 and 1025 are not (Brevo, mailpit). That
   * mapping is universal enough across providers to derive rather than ask for
   * — one fewer env var that can disagree with the port beside it.
   */
  const secure = env.SMTP_PORT === 465

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    // Mailpit takes no credentials; passing empty strings makes nodemailer
    // attempt AUTH with a blank user, which some servers reject outright.
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    pool: true,
    maxConnections: 3,
    // Mailpit has no certificate. Production hosts do, so this only ever
    // relaxes the local case.
    ...(isProduction ? {} : { tls: { rejectUnauthorized: false } }),
  })

  return transporter
}

export const smtpProvider: MailProvider = {
  name: 'smtp',

  async send(message: MailMessage): Promise<SentMail> {
    const info = await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })

    logger.info({ to: message.to, subject: message.subject, messageId: info.messageId }, 'mail sent')
    return { messageId: info.messageId }
  },
}

/** Closes the pool on shutdown so the process is not held open by idle sockets. */
export function closeSmtp(): void {
  transporter?.close()
  transporter = undefined
}
