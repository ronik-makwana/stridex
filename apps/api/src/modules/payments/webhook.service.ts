import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { sendOrderConfirmation, sendRefundCompleted } from '../mail/mail.service.js'
import { canTransition } from '../orders/order-status.js'
import { allGoodsRefunded, refundCeiling, type CountedRefund } from '../refunds/refund.math.js'
import type {
  ParsedPaymentWebhook,
  ParsedRefundWebhook,
  ParsedWebhook,
} from './providers/provider.types.js'

/**
 * What the provider says, becoming what is true.
 *
 * This is the only function in the codebase that turns a payment into an order,
 * and that is the point of the whole phase: the browser never decides (§12), the
 * customer's click never decides, and neither does the request that started the
 * payment. Money moved or it did not, and only the provider knows which.
 *
 * **Reconciliation calls this same function** (15.7). Two code paths that both
 * confirm orders will drift, and the one that runs less often is the one that
 * will be wrong at 2am.
 *
 * Everything below happens in one transaction or none of it does (§14). The
 * state this exists to make impossible is `payment = SUCCESS` with no order.
 */

export type WebhookOutcome =
  | {
      handled: true
      action: 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'REFUND_FAILED'
      orderId?: string
      orderNumber?: string
      refundId?: string
    }
  | { handled: false; reason: string }

/** `ORD-1000`, from a sequence — see prisma/sql/004. */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`
  return `ORD-${row!.nextval}`
}

const toPaise = (amount: Prisma.Decimal): number => amount.times(100).toNumber()

/**
 * The one door every provider event comes through, whichever direction the
 * money was going. Two tables, two sets of rules, one signature check and one
 * caller — the controller does not know there is a difference, and neither
 * does reconciliation.
 */
export async function handleProviderEvent(
  providerName: string,
  event: ParsedWebhook,
): Promise<WebhookOutcome> {
  return event.kind === 'refund'
    ? handleRefundEvent(providerName, event)
    : handlePaymentEvent(providerName, event)
}

async function handlePaymentEvent(
  providerName: string,
  event: ParsedPaymentWebhook,
): Promise<WebhookOutcome> {
  const payment = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: providerName,
        providerPaymentId: event.providerPaymentId,
      },
    },
  })

  /**
   * An event for a payment we never created. Answered 200 by the caller rather
   * than retried into eternity: a provider replaying somebody else's event, or
   * ours after a database restore, is not something a retry can fix.
   */
  if (!payment) return { handled: false, reason: 'No payment matches that provider id' }

  // ── duplicate delivery ─────────────────────────────────────────────────────
  //
  // Providers retry until they get a 2xx, and "at least once" means exactly
  // this case is the normal one, not the exotic one.
  if (payment.status === 'CAPTURED' && event.status !== 'FAILED') {
    return {
      handled: true,
      action: 'CAPTURED',
      orderId: payment.orderId ?? undefined,
      reason: undefined,
    } as WebhookOutcome
  }

  /**
   * Out of order, and the one case that genuinely needs a person: we already
   * gave the stock back and cancelled the session, and now the money is
   * reported as taken. Recording the capture is right — it is true — but
   * building an order on stock that has since been sold to somebody else is
   * not. It is logged loudly and left for a refund.
   */
  if (payment.status === 'FAILED' && event.status !== 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'CAPTURED', providerResponse: event.raw as Prisma.InputJsonValue },
    })
    logger.error(
      { paymentId: payment.id, providerPaymentId: event.providerPaymentId },
      'Capture arrived after this payment was already failed and released — needs a refund',
    )
    return { handled: false, reason: 'Capture arrived after failure; flagged for a human' }
  }

  if (event.status === 'FAILED') return failPayment(payment.id, event)

  // ── the amount has to be the amount ────────────────────────────────────────
  //
  // A confirmation for a different figure than the one quoted is not a
  // confirmation of this order. Refusing is the only safe answer (§5).
  if (event.amountInPaise && event.amountInPaise !== toPaise(payment.amount)) {
    logger.error(
      { paymentId: payment.id, quoted: toPaise(payment.amount), reported: event.amountInPaise },
      'Webhook amount does not match the quoted amount',
    )
    throw badRequest('That amount does not match the quoted total')
  }

  const outcome = await capturePayment(payment.id, event)

  /**
   * The confirmation, queued **after** `capturePayment` has returned — which is
   * to say after its transaction has committed.
   *
   * Queuing inside that transaction would let the worker read the order before
   * it exists, or send a confirmation for an order a later failure rolled back.
   * This is the first line where the order is a fact.
   *
   * Every path through this function ends up here, including the duplicate
   * delivery above and reconciliation, which calls this same function on a
   * schedule. That is intended: the job id is keyed on the order, so entering
   * repeatedly is what makes the email reliable rather than what duplicates it.
   */
  // `handled` first: the outcome is a discriminated union and `action` only
  // exists on the handled arm.
  if (outcome.handled && outcome.action === 'CAPTURED' && outcome.orderId) {
    await queueOrderConfirmation(outcome.orderId)
  }

  return outcome
}

// ─── success ─────────────────────────────────────────────────────────────────

async function capturePayment(paymentId: string, event: ParsedPaymentWebhook): Promise<WebhookOutcome> {
  return prisma.$transaction(async (tx) => {
    /**
     * Lock the payment row before reading anything from it.
     *
     * A plain `findUnique` here does **not** serialise two deliveries, which is
     * what this code assumed for a long time: at READ COMMITTED both
     * transactions read `PENDING`, both fall through the status check below,
     * and both go on to create an order. Nothing downstream catches it —
     * `checkout_sessions.order_id` is unique, but that only decides which of
     * the two orders the session ends up pointing at, not how many exist.
     *
     * It is not a theoretical race. `payments.reconcile` runs every five
     * minutes and calls this same function, so a webhook landing mid-sweep is
     * two concurrent captures of one payment.
     *
     * `FOR UPDATE` makes the second delivery wait for the first to commit; it
     * then reads `CAPTURED` and returns the order the first one made. Raw,
     * because Prisma has no first-class row lock — the same reason and the same
     * shape as `applyStockMove`.
     *
     * Locking the payment *first*, before any inventory row, is also what keeps
     * this deadlock-free: every path through a capture takes the two in that
     * order.
     */
    await tx.$queryRaw`SELECT id FROM payments WHERE id = CAST(${paymentId} AS uuid) FOR UPDATE`

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        session: {
          include: {
            items: true,
            reservations: { where: { status: 'ACTIVE' } },
            redemptions: { where: { status: 'ACTIVE' } },
            shippingAddress: true,
            billingAddress: true,
          },
        },
      },
    })

    // Now genuinely serialised by the lock above: a second delivery reaches
    // this line only after the first has committed its order.
    if (payment.status === 'CAPTURED') {
      return { handled: true, action: 'CAPTURED', orderId: payment.orderId ?? undefined }
    }

    const session = payment.session
    if (!session) {
      // The session is gone but the money is real. Record it and let a human
      // sort it out; inventing an order from nothing would be worse.
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'CAPTURED', providerResponse: event.raw as Prisma.InputJsonValue },
      })
      return { handled: false, reason: 'Payment has no checkout session' }
    }

    // ── the order, from the snapshots ────────────────────────────────────────
    //
    // Every field comes from `checkout_items`, never from today's catalog. That
    // is what lets this order render correctly in five years, after the product
    // has been renamed, repriced and archived (§19).
    const order = await tx.order.create({
      data: {
        userId: session.userId,
        orderNumber: await nextOrderNumber(tx),
        // Fulfilment has not started; payment is settled. Two fields because
        // they answer different questions (§11).
        status: 'PENDING',
        paymentStatus: 'PAID',
        subtotal: session.subtotal,
        // Every saving, in one figure: the lines' own discounts plus any
        // order-wide one. Without the first half, subtotal − discount +
        // shipping would not add up to what was charged.
        discountAmount: session.items
          .reduce((sum, item) => sum.plus(item.discountAmount), new Prisma.Decimal(0))
          .plus(session.discountAmount)
          .plus(session.shippingDiscount),
        // Broken out as well as counted above, so an order can say how much of
        // its saving was delivery — the shipping line still shows the rate.
        shippingDiscount: session.shippingDiscount,
        shippingAmount: session.shippingAmount,
        // The service, not just the charge. An order billed for next-day that
        // ships on the slow van is a refund, and the amount alone does not say
        // which one was bought.
        shippingMethod: session.shippingMethod,
        // No tax, by decision. The column stays, written zero, never rendered.
        taxAmount: 0,
        totalAmount: session.totalAmount,
        currency: session.currency,
        placedAt: new Date(),
        items: {
          create: session.items.map((item) => ({
            variantId: item.variantId,
            productTitle: item.productTitle,
            sku: item.sku,
            variantOptions: item.variantOptions as Prisma.InputJsonValue,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            discountAmount: item.discountAmount,
            discountCode: item.discountCode,
            orderDiscountAllocated: item.orderDiscountAllocated,
          })),
        },
        statusHistory: {
          create: { toStatus: 'PENDING', note: 'Payment confirmed by the provider' },
        },
      },
    })

    // A copy, not a pointer: editing the saved address later must not rewrite
    // where this parcel went (§19).
    for (const [type, address] of [
      ['SHIPPING', session.shippingAddress],
      ['BILLING', session.billingAddress ?? session.shippingAddress],
    ] as const) {
      if (!address) continue
      await tx.orderAddress.create({
        data: {
          orderId: order.id,
          type,
          fullName: address.fullName,
          phone: address.phone,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2,
          city: address.city,
          state: address.state,
          country: address.country,
          postalCode: address.postalCode,
        },
      })
    }

    // ── the stock actually leaves ────────────────────────────────────────────
    //
    // Until now it was only *held*: `reserved_quantity` spoke for it while
    // `quantity` stayed put. A sale is where both move, in one statement, and
    // the ledger row is what explains the difference afterwards.
    for (const hold of session.reservations) {
      const consumed = await tx.inventoryReservation.updateMany({
        where: { id: hold.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      })
      if (consumed.count === 0) continue

      await tx.$executeRaw`
        UPDATE inventories
           SET quantity = GREATEST(quantity - ${hold.quantity}, 0),
               reserved_quantity = GREATEST(reserved_quantity - ${hold.quantity}, 0),
               updated_at = now()
         WHERE variant_id = CAST(${hold.variantId} AS uuid)
      `

      const inventory = await tx.inventory.findUnique({
        where: { variantId: hold.variantId },
        select: { id: true },
      })
      if (inventory) {
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inventory.id,
            type: 'SALE',
            quantity: -hold.quantity,
            referenceType: 'order.sale',
            referenceId: order.id,
          },
        })
      }
    }

    /**
     * The codes are spent here, in the same transaction as the order.
     *
     * `used_count` is incremented only for a redemption this call actually
     * moved out of ACTIVE — a webhook delivered twice must not count the same
     * code twice, and `updateMany`'s count is what says whether this was the
     * delivery that did it (§8).
     */
    for (const redemption of session.redemptions) {
      const consumed = await tx.couponRedemption.updateMany({
        where: { id: redemption.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED', orderId: order.id },
      })
      if (consumed.count > 0) {
        await tx.coupon.update({
          where: { id: redemption.couponId },
          data: { usedCount: { increment: 1 } },
        })
      }
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: 'CAPTURED',
        orderId: order.id,
        providerResponse: event.raw as Prisma.InputJsonValue,
      },
    })
    await tx.paymentTransaction.create({
      data: {
        paymentId,
        type: 'CAPTURE',
        amount: payment.amount,
        providerTransactionId: event.eventId,
        metadata: event.raw as Prisma.InputJsonValue,
      },
    })

    await tx.checkoutSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', orderId: order.id },
    })

    // The cart has become an order. Leaving it full is how somebody buys the
    // same shoes twice on the next visit.
    await tx.cartItem.deleteMany({ where: { cart: { userId: session.userId } } })

    return { handled: true, action: 'CAPTURED', orderId: order.id, orderNumber: order.orderNumber }
  })
}

// ─── failure ─────────────────────────────────────────────────────────────────

/**
 * A decline. The stock goes back immediately — it was only ever held for a
 * payment that has now not happened — and the session is cancelled rather than
 * reopened, so the customer starts from a cart that still has everything in it
 * and gets a fresh quote at today's prices.
 */
async function failPayment(paymentId: string, event: ParsedPaymentWebhook): Promise<WebhookOutcome> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { session: { include: { reservations: { where: { status: 'ACTIVE' } } } } },
    })

    if (payment.status === 'FAILED') return { handled: true, action: 'FAILED' }

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'FAILED', providerResponse: event.raw as Prisma.InputJsonValue },
    })

    const session = payment.session
    if (!session) return { handled: true, action: 'FAILED' }

    for (const hold of session.reservations) {
      const released = await tx.inventoryReservation.updateMany({
        where: { id: hold.id, status: 'ACTIVE' },
        data: { status: 'RELEASED' },
      })
      if (released.count === 0) continue

      await tx.$executeRaw`
        UPDATE inventories
           SET reserved_quantity = GREATEST(reserved_quantity - ${hold.quantity}, 0),
               updated_at = now()
         WHERE variant_id = CAST(${hold.variantId} AS uuid)
      `

      const inventory = await tx.inventory.findUnique({
        where: { variantId: hold.variantId },
        select: { id: true },
      })
      if (inventory) {
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inventory.id,
            type: 'RELEASE',
            quantity: hold.quantity,
            referenceType: 'payment.failed',
            referenceId: session.id,
          },
        })
      }
    }

    for (const redemption of await tx.couponRedemption.findMany({
      where: { checkoutSessionId: session.id, status: 'ACTIVE' },
      select: { id: true },
    })) {
      await tx.couponRedemption.updateMany({
        where: { id: redemption.id, status: 'ACTIVE' },
        data: { status: 'RELEASED' },
      })
    }

    await tx.checkoutSession.updateMany({
      where: { id: session.id, status: { in: ['ACTIVE', 'PAYMENT_PENDING'] } },
      data: { status: 'CANCELLED' },
    })

    return { handled: true, action: 'FAILED' }
  })
}

/**
 * Queues the confirmation and records that it was queued.
 *
 * `confirmationSentAt` is what the sweep in `jobs/index.ts` reads: an order
 * that reaches PAID and never gets this far — the process died between the
 * commit and this line — is found later and queued then. Written after the
 * enqueue succeeds, so a failure here leaves the column null and the sweep
 * picks it up rather than recording a send that never happened.
 */
async function queueOrderConfirmation(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, confirmationSentAt: true, user: { select: { email: true } } },
    })

    // No account means no address to send to — a guest checkout, if one is ever
    // allowed. Nothing to do, and nothing wrong.
    if (!order?.user?.email) return
    if (order.confirmationSentAt) return

    await sendOrderConfirmation({ to: order.user.email, orderId })
    await prisma.order.update({
      where: { id: orderId },
      data: { confirmationSentAt: new Date() },
    })
  } catch (error) {
    /**
     * Swallowed on purpose. The order is paid for and recorded; a queue that is
     * briefly unreachable must not make this webhook answer 500, because the
     * provider would then retry an event that was fully and correctly handled.
     * The column stays null and the sweep sends it.
     */
    logger.error({ err: error, orderId }, 'could not queue order confirmation — sweep will retry')
  }
}

// ─── refunds ─────────────────────────────────────────────────────────────────

/**
 * Money going back, becoming money that has gone back.
 *
 * The mirror of `capturePayment`, and it earns the symmetry: our own service
 * asked for this refund, but asking is not settling. Until the provider says so
 * the row is PROCESSING, the customer has not been paid, and nothing here has
 * moved a status (§8, §12).
 *
 * What it deliberately does **not** touch is stock. Those units went back on
 * the shelf when the parcel was received, or when the order was cancelled —
 * both physical facts, both already recorded. Restocking here would mean a
 * provider retrying an event puts the same pair back twice.
 */
async function handleRefundEvent(
  providerName: string,
  event: ParsedRefundWebhook,
): Promise<WebhookOutcome> {
  const refund = await prisma.refund.findUnique({
    where: {
      provider_providerRefundId: {
        provider: providerName,
        providerRefundId: event.providerRefundId,
      },
    },
  })

  // A refund we never issued. 200 and a log, like an unknown payment: no retry
  // will make it ours.
  if (!refund) return { handled: false, reason: 'No refund matches that provider id' }

  // Delivered twice, which is the ordinary case rather than the exotic one.
  if (refund.status === 'SUCCEEDED') {
    return { handled: true, action: 'REFUNDED', orderId: refund.orderId, refundId: refund.id }
  }

  if (event.status === 'FAILED') return failRefund(refund.id, event)

  /**
   * A different figure than the one issued is not a settlement of this refund.
   * The same refusal `handlePaymentEvent` makes, for the same reason (§5) —
   * except here it is the customer who is short, which is worse.
   */
  if (event.amountInPaise && event.amountInPaise !== toPaise(refund.amount)) {
    logger.error(
      { refundId: refund.id, issued: toPaise(refund.amount), reported: event.amountInPaise },
      'Refund webhook amount does not match the refund that was issued',
    )
    throw badRequest('That amount does not match the refund that was issued')
  }

  const outcome = await settleRefund(refund.id, event)

  /**
   * Queued after the transaction has committed, like the order confirmation
   * above and for the same reason: the worker reads the refund back, and a row
   * a later failure rolled back must not produce an email saying money is on
   * its way.
   */
  if (outcome.handled && outcome.action === 'REFUNDED' && outcome.refundId) {
    await queueRefundCompleted(outcome.refundId)
  }

  return outcome
}

/**
 * "We have refunded ₹X" — the one message that speaks in the past tense,
 * because by here the provider has actually settled it.
 *
 * Swallowed on failure, like every other queue call on a webhook path: the
 * refund is recorded and correct, and answering 500 would make the provider
 * retry an event that was fully handled.
 */
async function queueRefundCompleted(refundId: string): Promise<void> {
  try {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      select: { order: { select: { user: { select: { email: true } } } } },
    })
    const email = refund?.order.user?.email
    if (!email) return
    await sendRefundCompleted({ to: email, refundId })
  } catch (error) {
    logger.error({ err: error, refundId }, 'could not queue the refund confirmation email')
  }
}

/**
 * The refund settled. One transaction: the refund row, the ledger entry, and
 * every status that now reads differently because of it.
 *
 * Both statuses are recomputed **from the database** rather than from this
 * event. A refund that arrives out of order, or one of two settling in the same
 * second, must leave the order saying what the rows actually add up to — not
 * what the most recent event happened to know.
 */
async function settleRefund(
  refundId: string,
  event: ParsedRefundWebhook,
): Promise<WebhookOutcome> {
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } })

    // Re-read inside the transaction: two deliveries racing each other both
    // passed the check outside it, and only this one is serialised.
    if (refund.status === 'SUCCEEDED') {
      return { handled: true, action: 'REFUNDED', orderId: refund.orderId, refundId: refund.id }
    }

    await tx.refund.update({
      where: { id: refundId },
      data: { status: 'SUCCEEDED', providerResponse: event.raw as Prisma.InputJsonValue },
    })

    // The same ledger the capture wrote to, with the sign the other way round.
    // `payment_transactions` is where "what happened to this money" is answered,
    // and a refund that is not in it is a refund the payment screen cannot see.
    await tx.paymentTransaction.create({
      data: {
        paymentId: refund.paymentId,
        type: 'REFUND',
        amount: refund.amount,
        providerTransactionId: event.providerRefundId,
        metadata: event.raw as Prisma.InputJsonValue,
      },
    })

    const order = await tx.order.findUniqueOrThrow({
      where: { id: refund.orderId },
      include: { items: true, refunds: { include: { items: true } } },
    })

    const counted: CountedRefund[] = order.refunds.map((row) => ({
      status: row.status,
      amount: row.amount,
      items: row.items,
    }))

    /**
     * Two questions, two columns (§11).
     *
     * `payment_status` asks whether every rupee is back — and a customer who
     * returned every item still leaves the delivery charge with the store, so
     * that is PARTIALLY_REFUNDED and honestly so.
     *
     * `status` asks whether the goods came home, which is a fulfilment fact and
     * has nothing to do with what shipping cost.
     */
    const outstanding = refundCeiling(order, counted)
    const paymentStatus = outstanding.lessThanOrEqualTo(0) ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
    const goodsHome = allGoodsRefunded(order.items, counted)

    /**
     * A cancelled order stays CANCELLED. It is already terminal, already the
     * truth the customer was told, and `order-status.ts` forbids the move —
     * which is checked rather than assumed, because the state machine is the
     * authority on this and not this file.
     */
    const movesToRefunded = goodsHome && canTransition(order.status, 'REFUNDED')

    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus, ...(movesToRefunded ? { status: 'REFUNDED' } : {}) },
    })

    if (movesToRefunded) {
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'REFUNDED',
          changedByUserId: refund.initiatedByUserId,
          note: 'Every item on this order has been refunded',
        },
      })
    }

    /**
     * The payment record follows the money too, and `PaymentRecordStatus` has
     * no partial: it is REFUNDED only once nothing of it is left. Summed from
     * settled refunds against *that* payment rather than the order, because an
     * order can in principle have been paid by more than one.
     */
    const settledOnPayment = await tx.refund.aggregate({
      where: { paymentId: refund.paymentId, status: 'SUCCEEDED' },
      _sum: { amount: true },
    })
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } })
    if ((settledOnPayment._sum.amount ?? new Prisma.Decimal(0)).greaterThanOrEqualTo(payment.amount)) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } })
    }

    /**
     * The request is done when nothing it asked for is still in flight. A
     * partial approval that was refunded in two goes closes on the second, and
     * a request whose refund failed stays open for somebody to retry.
     */
    if (refund.requestId) {
      const inFlight = await tx.refund.count({
        where: { requestId: refund.requestId, status: { in: ['PENDING', 'PROCESSING'] } },
      })
      if (inFlight === 0) {
        await tx.refundRequest.updateMany({
          where: { id: refund.requestId, status: { in: ['APPROVED', 'RECEIVED'] } },
          data: { status: 'COMPLETED' },
        })
      }
    }

    return {
      handled: true,
      action: 'REFUNDED',
      orderId: order.id,
      orderNumber: order.orderNumber,
      refundId: refund.id,
    }
  })
}

/**
 * The provider declined to send the money.
 *
 * Nothing is reversed. The parcel is still back on the shelf and the request is
 * still received — both of those happened in the warehouse and are not undone
 * by a bank saying no. What is needed is a person: the row keeps the reason,
 * the request stays open, and this is logged at error because a customer is
 * owed money that has not arrived.
 */
async function failRefund(
  refundId: string,
  event: ParsedRefundWebhook,
): Promise<WebhookOutcome> {
  const refund = await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: 'FAILED',
      failureReason: event.failureReason ?? 'The provider declined the refund',
      providerResponse: event.raw as Prisma.InputJsonValue,
    },
  })

  logger.error(
    { refundId, orderId: refund.orderId, reason: event.failureReason },
    'A refund failed at the provider — the customer has not been paid',
  )

  return { handled: true, action: 'REFUND_FAILED', orderId: refund.orderId, refundId }
}
