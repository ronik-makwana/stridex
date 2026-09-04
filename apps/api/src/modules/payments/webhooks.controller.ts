import type { RequestHandler } from 'express'
import { badRequest, unauthorized } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { getProvider } from './providers/index.js'
import { handleProviderEvent } from './webhook.service.js'

/**
 * The provider talking to us. No session, no CSRF token, no rate limit — its
 * only credential is the signature, and dropping a confirmation because a
 * limiter was busy would be worse than any load it could generate.
 *
 * What it answers matters as much as what it does. A provider retries anything
 * that is not 2xx, so:
 *
 *   - bad signature       → 401, and it stops
 *   - event we ignore     → 200, because it will never become interesting
 *   - unknown payment     → 200, because retrying will never make it known
 *   - handled, or already → 200
 *   - our own failure     → 500, because a retry genuinely might work
 */
export const receive: RequestHandler = async (req, res) => {
  const providerName = String(req.params.provider ?? '')
  const provider = getProvider(providerName)

  // The bytes as they arrived. Anything else is a different document.
  const raw = req.rawBody
  if (!raw) throw badRequest('That webhook had no body')

  const signature =
    req.header('X-Webhook-Signature') ?? req.header('X-Razorpay-Signature') ?? undefined

  if (!provider.verifySignature(raw, signature)) {
    logger.warn({ provider: providerName }, 'Rejected a webhook with an invalid signature')
    throw unauthorized('That signature does not verify')
  }

  /**
   * Null means "a real event of theirs that we do not act on" — `order.paid`, a
   * settlement, whatever they add next. 200 and done: it is not an error, and
   * anything else here would have them redeliver it until they gave up.
   */
  const event = provider.parseWebhook(raw)
  if (!event) {
    logger.info({ provider: providerName }, 'Webhook understood and not acted on')
    return void res.status(200).json({ received: true, handled: false, reason: 'Event not acted on' })
  }

  const outcome = await handleProviderEvent(provider.name, event)

  if (!outcome.handled) {
    logger.warn({ provider: providerName, event: event.eventId, reason: outcome.reason }, 'Webhook ignored')
  }

  // 200 either way: an event we cannot act on is not an event worth retrying.
  res.status(200).json({ received: true, ...outcome })
}
