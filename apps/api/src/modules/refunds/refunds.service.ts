import { Prisma, type RefundReason } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { unprocessable } from '../../lib/errors.js'
import { getProvider } from '../payments/providers/index.js'
import { applyStockMove } from '../inventory/inventory.service.js'
import { refundCeiling, type CountedRefund, type RefundableOrder } from './refund.math.js'

/**
 * Issuing a refund: the one place money is ever sent back.
 *
 * Both roads — a customer cancelling, an operator settling a return — end here,
 * for the same reason the webhook is the only place an order is ever created. A
 * second way to refund is a second set of caps, a second idempotency key, and a
 * second answer to "how much is left", and the one that runs less often is the
 * one that will be wrong.
 *
 * The shape is deliberately the same as taking money:
 *
 *   1. write the row PENDING, inside the caller's transaction
 *   2. commit — so a crash leaves a refund somebody can see and retry
 *   3. ask the provider, and record what it said
 *   4. wait for the webhook, which is the only thing that writes SUCCEEDED
 *
 * Step 2 is the reason `issue` is split in two. A provider call inside a
 * transaction holds a database connection open across the network, and a
 * timeout there would roll back the row for a refund that may well have been
 * accepted — the worst outcome available (§8, §14).
 */

export type RefundLine = { orderItemId: string; quantity: number; amount: Prisma.Decimal }

export type IssueRefundInput = {
  orderId: string
  paymentId: string
  amount: Prisma.Decimal
  items: RefundLine[]
  reason: RefundReason
  /** Ours. Deterministic where a caller can name the event; see `keyFor`. */
  idempotencyKey: string
  requestId?: string | null
  /** Null when the system issued it — a self-serve cancellation. */
  initiatedByUserId?: string | null
  /** Internal. Staff read it on the order; the customer never does. */
  note?: string | null
}

/**
 * Refund keys, named after what caused them rather than randomly.
 *
 * A cancellation can only ever refund an order once, and a return can only ever
 * settle a request once — so those two keys are derived, and a duplicate call
 * collides on the unique index instead of sending a second lot of money. Only
 * a discretionary refund needs a random key, because an operator refunding ₹200
 * twice on purpose is a real thing to want.
 */
export const keyFor = {
  cancellation: (orderId: string) => `cancel:${orderId}`,
  /**
   * `sequence` is how many refunds this request has already produced. A parcel
   * can arrive in two halves — two of three pairs today, the third next week —
   * and each receipt is its own refund. Keying on the request alone would make
   * the second one collide with the first and silently pay nothing.
   */
  request: (requestId: string, sequence: number) => `request:${requestId}:${sequence}`,
  manual: (token: string) => `manual:${token}`,
}

/**
 * Step 1, inside the caller's transaction: the row, and the last cap before it.
 *
 * The ceiling is checked here rather than by the caller because this is the
 * only place that sees every refund on the order — including ones still in
 * flight, which is what stops two refunds racing past the same remaining
 * balance (§7).
 */
export async function createRefundRow(
  tx: Prisma.TransactionClient,
  input: IssueRefundInput,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      totalAmount: true,
      shippingAmount: true,
      shippingDiscount: true,
      currency: true,
      refunds: { include: { items: true } },
    },
  })

  const counted: CountedRefund[] = order.refunds.map((row) => ({
    status: row.status,
    amount: row.amount,
    items: row.items,
  }))

  const ceiling = refundCeiling(order as RefundableOrder, counted)
  if (input.amount.greaterThan(ceiling)) {
    throw unprocessable(
      'That is more than is left to refund on this order',
      `At most ${ceiling.toFixed(2)} can still go back.`,
    )
  }
  if (input.amount.lessThanOrEqualTo(0)) {
    throw unprocessable('There is nothing left to refund on this order')
  }

  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: input.paymentId },
    select: { provider: true },
  })

  return tx.refund.create({
    data: {
      orderId: input.orderId,
      paymentId: input.paymentId,
      requestId: input.requestId ?? null,
      amount: input.amount,
      currency: order.currency,
      status: 'PENDING',
      reason: input.reason,
      note: input.note ?? null,
      provider: payment.provider,
      idempotencyKey: input.idempotencyKey,
      initiatedByUserId: input.initiatedByUserId ?? null,
      items: {
        create: input.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          amount: item.amount,
        })),
      },
    },
  })
}

/**
 * Step 3, after the caller's transaction has committed: ask the provider.
 *
 * Never throws. A refund the provider refused is a row that says so and a
 * person who has to look at it — not a 500 handed back to a customer whose
 * order is, by this point, already cancelled and already restocked. The
 * cancellation succeeded; only the money is late.
 */
export async function sendToProvider(refundId: string): Promise<void> {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { payment: { select: { providerPaymentId: true } } },
  })
  if (!refund || refund.status !== 'PENDING') return

  try {
    const provider = getProvider(refund.provider)
    const accepted = await provider.refundPayment({
      providerPaymentId: refund.payment.providerPaymentId,
      amountInPaise: refund.amount.times(100).toNumber(),
      idempotencyKey: refund.idempotencyKey,
      note: refund.note,
    })

    await prisma.refund.update({
      where: { id: refundId },
      data: {
        // PROCESSING even when the provider says SUCCEEDED. Their synchronous
        // answer is not the settlement; the webhook is (§8, §12).
        status: 'PROCESSING',
        providerRefundId: accepted.providerRefundId,
        providerResponse: accepted.raw as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'FAILED',
        failureReason: error instanceof Error ? error.message : 'The provider could not be reached',
      },
    })
    logger.error(
      { err: error, refundId, orderId: refund.orderId },
      'Could not issue a refund at the provider — the customer has not been paid',
    )
  }
}

// ─── the two side effects a refund can have ──────────────────────────────────

/**
 * Stock coming back, for goods that never left.
 *
 * Only ever called for a **cancellation**: the order was paid, so the units
 * were decremented as a SALE, and nothing has shipped — so putting them back is
 * a fact rather than a guess. A return goes through the same ledger but only
 * once somebody has the parcel in their hands (15.5).
 *
 * Every move goes through `applyStockMove`, which takes the row lock and writes
 * the ledger entry in the same breath. Never `inventory.update`.
 */
export async function restockCancelledOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string | null,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { variantId: true, quantity: true },
  })

  for (const item of items) {
    // A variant deleted since the order was placed leaves the line intact — it
    // is a snapshot — but there is nothing left to restock. The refund is not
    // held up by it.
    if (!item.variantId) continue

    await applyStockMove(tx, {
      variantId: item.variantId,
      delta: item.quantity,
      // RETURN, not RELEASE: RELEASE means a hold coming off `reserved_quantity`
      // everywhere else in this codebase, and the hold was consumed at the sale.
      // This is `quantity` going back up. The reason lives in `referenceType`,
      // exactly as `inventory.schema.ts` describes.
      type: 'RETURN',
      referenceType: 'order.cancelled',
      referenceId: orderId,
      userId: actorId,
    })
  }
}

/**
 * The coupon use, handed back.
 *
 * A cancelled order was never really an order, so a single-use code spent on it
 * must work again — otherwise the customer is refunded in full and still cannot
 * re-place the order they just cancelled. `used_count` moves with the
 * redemptions because the admin screens read the counter while the gates count
 * the rows, and the two disagreeing is worse than either being wrong.
 *
 * Not called on a return. That code was genuinely spent: the goods arrived, and
 * a partial return cannot unwind a discount the rest of the order still earns.
 */
export async function releaseCoupons(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const redemptions = await tx.couponRedemption.findMany({
    where: { orderId, status: 'CONSUMED' },
    select: { id: true, couponId: true },
  })

  for (const redemption of redemptions) {
    // Conditional, and the count is what decides: a second call finds the row
    // already RELEASED, moves nothing, and must not decrement the counter again.
    const released = await tx.couponRedemption.updateMany({
      where: { id: redemption.id, status: 'CONSUMED' },
      data: { status: 'RELEASED' },
    })
    if (released.count === 0) continue

    await tx.coupon.update({
      where: { id: redemption.couponId },
      data: { usedCount: { decrement: 1 } },
    })
  }
}
