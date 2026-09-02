import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { getProvider } from '../payments/providers/index.js'
import { handleProviderEvent } from '../payments/webhook.service.js'
import type { ParsedRefundWebhook } from '../payments/providers/provider.types.js'
import { sendToProvider } from './refunds.service.js'

/**
 * What to do when the refund webhook never came.
 *
 * The mirror of `payments/reconcile.service.ts`, and wanted more urgently than
 * its original: a payment stuck in PENDING is stock nobody can sell, while a
 * refund stuck in PROCESSING is a customer who has sent their shoes back and is
 * waiting for money that our records say is on its way. Nothing about that
 * resolves itself (§9, §10).
 *
 * Two failures, two answers:
 *
 *   PENDING     the row was written and the provider was never asked — the
 *               process died between the commit and the call. Ask now.
 *   PROCESSING  the provider was asked and never came back. Read their record
 *               and let the webhook handler decide, exactly as if the webhook
 *               had arrived.
 *
 * **It calls the same handler the webhook calls**, which is the single most
 * important line here. A second path that also settles refunds would drift from
 * the first, and the one that runs less often is the one that will be wrong.
 */

/** Give the webhook a fair chance before going and asking. */
const MIN_AGE_MINUTES = 10
/** Past this, stop asking and tell a person. Somebody is owed money. */
const LOOKBACK_HOURS = 24

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

/** A synthetic event, so the outcome takes exactly the webhook's path. */
function asEvent(
  refund: { id: string; providerRefundId: string | null; payment: { providerPaymentId: string } },
  status: ParsedRefundWebhook['status'],
  reason: string,
  amountInPaise = 0,
): ParsedRefundWebhook {
  return {
    kind: 'refund',
    eventId: `reconcile:${refund.id}:${status}`,
    providerRefundId: refund.providerRefundId!,
    providerPaymentId: refund.payment.providerPaymentId,
    status,
    amountInPaise,
    failureReason: status === 'FAILED' ? reason : null,
    // Kept verbatim in `provider_response`, so the row says who decided this
    // and why — a reconciled failure must not look like a provider's decline.
    raw: { source: 'reconciliation', reason, decidedAt: new Date().toISOString() },
  }
}

export type RefundReconcileResult = {
  checked: number
  sent: number
  settled: number
  failed: number
  pending: number
  alerted: number
}

export async function reconcileStuckRefunds(limit = 100): Promise<RefundReconcileResult> {
  const stale = await prisma.refund.findMany({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      updatedAt: { lt: minutesAgo(MIN_AGE_MINUTES) },
    },
    include: { payment: { select: { providerPaymentId: true } } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  const result: RefundReconcileResult = {
    checked: 0,
    sent: 0,
    settled: 0,
    failed: 0,
    pending: 0,
    alerted: 0,
  }

  for (const refund of stale) {
    result.checked += 1
    const ageMinutes = (Date.now() - refund.createdAt.getTime()) / 60_000

    try {
      /**
       * Never handed over. Retrying is safe because the idempotency key is on
       * the row: if the first call did reach the provider before the process
       * died, this returns that same refund rather than making a second one.
       */
      if (refund.status === 'PENDING' || !refund.providerRefundId) {
        await sendToProvider(refund.id)
        result.sent += 1
        continue
      }

      const provider = getProvider(refund.provider)
      const state = await provider.getRefund(refund.providerRefundId)

      if (!state) {
        // No record of a refund we hold an id for. That is not something a
        // retry fixes, and it is money somebody is waiting for.
        logger.error(
          { refundId: refund.id, providerRefundId: refund.providerRefundId },
          'The provider has no record of a refund we issued',
        )
        result.alerted += 1
        continue
      }

      if (state.status === 'SUCCEEDED') {
        await handleProviderEvent(
          refund.provider,
          asEvent(refund, 'SUCCEEDED', 'Confirmed by reconciliation', state.amountInPaise),
        )
        result.settled += 1
        continue
      }

      if (state.status === 'FAILED') {
        await handleProviderEvent(
          refund.provider,
          asEvent(refund, 'FAILED', 'The provider reports this refund failed'),
        )
        result.failed += 1
        continue
      }

      /**
       * Still in flight at the provider, and — unlike a payment — that is never
       * turned into a failure here. Failing a payment releases stock and costs
       * nobody anything; failing a refund that is genuinely on its way would
       * invite somebody to send the money a second time. Past the lookback it
       * is escalated to a person instead, and left alone.
       */
      if (ageMinutes > LOOKBACK_HOURS * 60) {
        logger.error(
          { refundId: refund.id, providerRefundId: refund.providerRefundId, ageMinutes },
          'A refund has been unsettled for over a day — the customer is still waiting',
        )
        result.alerted += 1
        continue
      }
      result.pending += 1
    } catch (error) {
      // One refund that cannot be reconciled must not stop the pass: the next
      // one in the list is somebody else's money.
      logger.error({ err: error, refundId: refund.id }, 'Could not reconcile a refund')
    }
  }

  if (result.checked > 0) logger.info(result, 'Refund reconciliation pass complete')
  return result
}
