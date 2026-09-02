import { env } from '../../../config/env.js'
import { logProvider } from './log.provider.js'
import { smtpProvider, closeSmtp } from './smtp.provider.js'
import type { MailProvider } from './provider.types.js'

const providers: Record<string, MailProvider> = {
  [smtpProvider.name]: smtpProvider,
  [logProvider.name]: logProvider,
}

/**
 * The configured provider. Mirrors `payments/providers/index.ts`, except that
 * the choice is derived rather than declared: **no `SMTP_HOST` means no way to
 * send**, so the log provider is not a preference there, it is the only honest
 * option. One variable instead of two that can contradict each other.
 */
export function getProvider(name?: string): MailProvider {
  const chosen = name ?? (env.SMTP_HOST ? smtpProvider.name : logProvider.name)
  const provider = providers[chosen]
  if (!provider) throw new Error(`Unknown mail provider "${chosen}"`)
  return provider
}

export { closeSmtp }
export type { MailProvider, MailMessage, SentMail } from './provider.types.js'
