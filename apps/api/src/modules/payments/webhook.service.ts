import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import type { ParsedWebhook } from './providers/provider.types.js'

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
  | { handled: true; action: 'CAPTURED' | 'FAILED'; orderId?: string; orderNumber?: string }
  | { handled: false; reason: string }

/** `ORD-1000`, from a sequence — see prisma/sql/004. */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`
  return `ORD-${row!.nextval}`
}

const toPaise = (amount: Prisma.Decimal): number => amount.times(100).toNumber()

export async function handleProviderEvent(
  providerName: string,
  event: ParsedWebhook,
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

  return capturePayment(payment.id, event)
}

// ─── success ─────────────────────────────────────────────────────────────────

async function capturePayment(paymentId: string, event: ParsedWebhook): Promise<WebhookOutcome> {
  return prisma.$transaction(async (tx) => {
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

    // Re-read inside the transaction: two deliveries racing each other both
    // passed the check outside it, and only this one is serialised.
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
        discountAmount: session.discountAmount,
        shippingAmount: session.shippingAmount,
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

    // Coupons: nothing holds one today, and the loop is here so that the day
    // one does, consuming it is not a step somebody forgets to add.
    for (const redemption of session.redemptions) {
      await tx.couponRedemption.updateMany({
        where: { id: redemption.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED', orderId: order.id },
      })
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
async function failPayment(paymentId: string, event: ParsedWebhook): Promise<WebhookOutcome> {
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
