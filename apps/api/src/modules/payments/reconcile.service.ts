import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { getProvider } from './providers/index.js'
import { handleProviderEvent } from './webhook.service.js'
import type { ParsedWebhook } from './providers/provider.types.js'

/**
 * What to do when the webhook never came.
 *
 * Webhooks get lost — a deploy at the wrong second, a network partition, a
 * provider outage — and a payment stuck in PENDING is a customer whose money
 * may or may not have moved and whose stock is held either way. Nothing about
 * that resolves itself, so something has to go and ask (§9, §10).
 *
 * **This calls the same handler the webhook calls.** It is the single most
 * important line in the file: a second code path that also confirms orders will
 * drift from the first, and the one that runs less often is the one that will
 * be wrong when it finally matters.
 */

/** Give the webhook a fair chance before going and asking. */
const MIN_AGE_MINUTES = 10
/** A provider with no record of it after this long never received the request. */
const NO_RECORD_MINUTES = 30
/** Past this, stop asking and tell a person. Retrying forever is not a strategy. */
const LOOKBACK_HOURS = 24

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

/** A synthetic event, so the outcome takes exactly the webhook's path. */
function asEvent(
  payment: { id: string; providerPaymentId: string; checkoutSessionId: string | null },
  status: ParsedWebhook['status'],
  reason: string,
  amountInPaise = 0,
): ParsedWebhook {
  return {
    eventId: `reconcile:${payment.id}:${status}`,
    providerPaymentId: payment.providerPaymentId,
    status,
    amountInPaise,
    reference: payment.checkoutSessionId,
    failureReason: status === 'FAILED' ? reason : null,
    // Kept verbatim in `provider_response`, so the row says who decided this
    // and why — a reconciled failure must not look like a provider's decline.
    raw: { source: 'reconciliation', reason, decidedAt: new Date().toISOString() },
  }
}

export type ReconcileResult = {
  checked: number
  captured: number
  failed: number
  pending: number
  alerted: number
}

export async function reconcilePendingPayments(limit = 100): Promise<ReconcileResult> {
  const stale = await prisma.payment.findMany({
    where: {
      status: { in: ['PENDING', 'AUTHORIZED'] },
      createdAt: { lt: minutesAgo(MIN_AGE_MINUTES) },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  const result: ReconcileResult = { checked: 0, captured: 0, failed: 0, pending: 0, alerted: 0 }

  for (const payment of stale) {
    result.checked += 1
    const ageMinutes = (Date.now() - payment.createdAt.getTime()) / 60_000

    try {
      // Past the lookback: stop asking. Something is wrong that a retry cannot
      // fix, and the stock has been held for a day (§9).
      if (ageMinutes > LOOKBACK_HOURS * 60) {
        logger.error(
          { paymentId: payment.id, providerPaymentId: payment.providerPaymentId, ageMinutes },
          'Payment unresolved past the lookback window — failing it and alerting',
        )
        await handleProviderEvent(
          payment.provider,
          asEvent(payment, 'FAILED', 'Unresolved past the 24-hour reconciliation window'),
        )
        result.failed += 1
        result.alerted += 1
        continue
      }

      const provider = getProvider(payment.provider)
      const state = await provider.getPayment(payment.providerPaymentId)

      // No record at all. Either the request never landed, or it landed as
      // something we cannot match — after half an hour, treat it as never.
      if (!state) {
        if (ageMinutes < NO_RECORD_MINUTES) {
          result.pending += 1
          continue
        }
        await handleProviderEvent(
          payment.provider,
          asEvent(payment, 'FAILED', 'The provider has no record of this payment'),
        )
        result.failed += 1
        continue
      }

      if (state.status === 'CAPTURED' || state.status === 'AUTHORIZED') {
        // The webhook was lost, the money moved. Same handler, and it is
        // idempotent — if the webhook turns up later it changes nothing.
        await handleProviderEvent(
          payment.provider,
          asEvent(payment, 'CAPTURED', 'Confirmed by reconciliation', state.amountInPaise),
        )
        result.captured += 1
        continue
      }

      if (state.status === 'FAILED') {
        await handleProviderEvent(
          payment.provider,
          asEvent(payment, 'FAILED', 'The provider reports this payment failed'),
        )
        result.failed += 1
        continue
      }

      // Still pending at the provider. Leave it: a payment being processed is
      // not a payment to fail, and the next pass will ask again (§9).
      if (ageMinutes >= NO_RECORD_MINUTES) {
        await handleProviderEvent(
          payment.provider,
          asEvent(payment, 'FAILED', `Still unconfirmed after ${NO_RECORD_MINUTES} minutes`),
        )
        result.failed += 1
        continue
      }
      result.pending += 1
    } catch (error) {
      // One payment that cannot be reconciled must not stop the pass: the next
      // one in the list may be the one holding the last pair of shoes.
      logger.error({ err: error, paymentId: payment.id }, 'Could not reconcile a payment')
    }
  }

  if (result.checked > 0) logger.info(result, 'Reconciliation pass complete')
  return result
}
