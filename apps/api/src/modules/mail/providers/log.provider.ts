import { logger } from '../../../lib/logger.js'
import type { MailMessage, MailProvider, SentMail } from './provider.types.js'

/**
 * Renders and logs, sends nothing.
 *
 * For tests and CI, where no SMTP is listening and a suite that needed one
 * would be a suite that fails on someone else's laptop. Mailpit covers the
 * "look at the email" case far better in development, which is why this is the
 * narrow fallback and not the default.
 *
 * The body is logged at debug and the subject at info: a rendered order
 * confirmation is several kilobytes, and a test run should not have to scroll
 * past it.
 */
export const logProvider: MailProvider = {
  name: 'log',

  async send(message: MailMessage): Promise<SentMail> {
    const messageId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    logger.info({ to: message.to, subject: message.subject, messageId }, 'mail sent (log provider)')
    logger.debug({ messageId, text: message.text }, 'mail body')
    return { messageId }
  },
}
