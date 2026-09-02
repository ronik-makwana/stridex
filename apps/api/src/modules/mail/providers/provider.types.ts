/**
 * The one thing a mail provider has to do, and the whole of what the rest of
 * the codebase knows about one.
 *
 * Same argument as `PaymentProvider`: everything above this interface — the
 * templates, the queue, the Phase 23 hooks — is provider-agnostic, so swapping
 * SES for Resend is one file and no callers.
 */

export type MailMessage = {
  to: string
  subject: string
  /** Both, always. See `RenderedMail`. */
  html: string
  text: string
}

export type SentMail = {
  /** The provider's id, for correlating a complaint with a log line. */
  messageId: string
}

export interface MailProvider {
  readonly name: string

  /**
   * Throws on failure rather than returning a result. The queue is what turns a
   * throw into a retry, and a provider that swallows an error would report five
   * successful sends of an email nobody received.
   */
  send(message: MailMessage): Promise<SentMail>
}
