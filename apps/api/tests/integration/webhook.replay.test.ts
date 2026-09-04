import { prisma } from '@shoe/db'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleProviderEvent } from '../../src/modules/payments/webhook.service.js'
import type { ParsedWebhook } from '../../src/modules/payments/providers/provider.types.js'
import { createPaidCheckout, resetFactorySequence } from '../setup/factories.js'

/**
 * "At least once" is the normal case, not the exotic one: a provider retries
 * until it gets a 2xx, and a network blip between our commit and their reading
 * the response produces a second delivery of an event we already acted on.
 *
 * So the property under test is not "the webhook works" — it is that the
 * *second* one changes nothing. That is enforced partly by code and partly by
 * a unique index on `orders.checkout_session_id`, which is why this cannot be
 * a unit test: mocking Prisma would mock away the constraint doing the work.
 */

beforeEach(() => {
  resetFactorySequence()
})

const captured = (providerPaymentId: string, amountInPaise: number): ParsedWebhook => ({
  kind: 'payment',
  eventId: `payment.captured:${providerPaymentId}`,
  providerPaymentId,
  status: 'CAPTURED',
  amountInPaise,
  reference: null,
  failureReason: null,
  raw: { id: providerPaymentId },
})

const failed = (providerPaymentId: string): ParsedWebhook => ({
  kind: 'payment',
  eventId: `payment.failed:${providerPaymentId}`,
  providerPaymentId,
  status: 'FAILED',
  amountInPaise: 0,
  reference: null,
  failureReason: 'Card declined',
  raw: { id: providerPaymentId },
})

const toPaise = (amount: string) => Math.round(Number(amount) * 100)

describe('a captured payment', () => {
  it('creates the order and marks the payment captured', async () => {
    const { payment, total } = await createPaidCheckout()

    const outcome = await handleProviderEvent(
      'razorpay',
      captured(payment.providerPaymentId, toPaise(total)),
    )

    expect(outcome.handled).toBe(true)
    expect(await prisma.order.count()).toBe(1)

    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(settled.status).toBe('CAPTURED')
    expect(settled.orderId).not.toBeNull()
  })

  it('closes the checkout session and links it to the order', async () => {
    const { payment, session, total } = await createPaidCheckout()

    await handleProviderEvent('razorpay', captured(payment.providerPaymentId, toPaise(total)))

    const closed = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(closed.status).toBe('COMPLETED')
    expect(closed.orderId).not.toBeNull()
  })

  /** The held units become sold units: reserved goes back, quantity comes down. */
  it('converts the hold into a sale rather than releasing it', async () => {
    const { payment, variant, quantity, total } = await createPaidCheckout()

    await handleProviderEvent('razorpay', captured(payment.providerPaymentId, toPaise(total)))

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variant.id },
    })
    expect(inventory.reservedQuantity).toBe(0)
    expect(inventory.quantity).toBe(10 - quantity)

    const reservation = await prisma.inventoryReservation.findFirstOrThrow({
      where: { variantId: variant.id },
    })
    expect(reservation.status).not.toBe('ACTIVE')
  })

  it('copies the line onto the order, priced as the session was', async () => {
    const { payment, quantity, total } = await createPaidCheckout({ unitPrice: '1500.00' })

    await handleProviderEvent('razorpay', captured(payment.providerPaymentId, toPaise(total)))

    const item = await prisma.orderItem.findFirstOrThrow()
    expect(item.quantity).toBe(quantity)
    expect(item.unitPrice.toFixed(2)).toBe('1500.00')
  })
})

describe('the same event delivered twice', () => {
  /** The property this whole file exists for. */
  it('creates exactly one order', async () => {
    const { payment, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    await handleProviderEvent('razorpay', event)
    await handleProviderEvent('razorpay', event)

    expect(await prisma.order.count()).toBe(1)
    expect(await prisma.orderItem.count()).toBe(1)
  })

  it('reports the same order id both times', async () => {
    const { payment, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    const first = await handleProviderEvent('razorpay', event)
    const second = await handleProviderEvent('razorpay', event)

    expect(second.handled).toBe(true)
    expect((second as { orderId?: string }).orderId).toBe((first as { orderId?: string }).orderId)
  })

  /** A second delivery must not deduct the stock a second time. */
  it('does not move stock again', async () => {
    const { payment, variant, quantity, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    await handleProviderEvent('razorpay', event)
    await handleProviderEvent('razorpay', event)

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variant.id },
    })
    expect(inventory.quantity).toBe(10 - quantity)
  })

  /**
   * The concurrent case, which sequential replay does not cover at all.
   *
   * Both deliveries pass the pre-transaction status check before either
   * commits, so the only thing that separates them is the `FOR UPDATE` lock
   * `capturePayment` takes on the payment row. Without it each inserts its own
   * order — and nothing downstream catches that, because the unique index on
   * `checkout_sessions.order_id` only decides which order the session points
   * at, not how many exist.
   *
   * Reachable without an unusual provider: `payments.reconcile` runs every five
   * minutes and calls the same function.
   */
  it('creates one order even when both deliveries race', async () => {
    const { payment, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    await Promise.allSettled([
      handleProviderEvent('razorpay', event),
      handleProviderEvent('razorpay', event),
    ])

    expect(await prisma.order.count()).toBe(1)
    expect(await prisma.orderItem.count()).toBe(1)
  })

  /** Two is the pair that races; more is the pair plus a reconcile sweep. */
  it('creates one order under several simultaneous deliveries', async () => {
    const { payment, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    await Promise.allSettled(
      Array.from({ length: 6 }, () => handleProviderEvent('razorpay', event)),
    )

    expect(await prisma.order.count()).toBe(1)
  })

  /**
   * All six must be told about the *same* order. Returning "handled" with no
   * order id would leave the confirmation email unqueued for that delivery.
   */
  it('reports the same order to every racing delivery', async () => {
    const { payment, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => handleProviderEvent('razorpay', event)),
    )

    const orderIds = new Set(outcomes.map((o) => (o as { orderId?: string }).orderId))
    expect(orderIds.size).toBe(1)
    expect([...orderIds][0]).toBeTruthy()
  })

  /**
   * The blast radius of the race above, pinned down so a future fix cannot
   * quietly make any of it worse.
   *
   * Stock is safe because `applyStockMove` takes a real row lock, and the
   * money is safe because the payment row is updated once. The duplicate is a
   * record the customer can see, not a shoe sold twice.
   */
  it('does not double-count stock or money when two deliveries race', async () => {
    const { payment, variant, session, quantity, total } = await createPaidCheckout()
    const event = captured(payment.providerPaymentId, toPaise(total))

    await Promise.allSettled([
      handleProviderEvent('razorpay', event),
      handleProviderEvent('razorpay', event),
    ])

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variant.id },
    })
    const ledger = await prisma.inventoryTransaction.findMany({
      where: { inventory: { variantId: variant.id } },
      select: { quantity: true },
    })

    // Sold once, not twice, and the ledger agrees with the row.
    expect(inventory.quantity).toBe(10 - quantity)
    expect(ledger.reduce((sum, row) => sum + row.quantity, 0)).toBe(-quantity)
    expect(inventory.reservedQuantity).toBe(0)

    // The money is attached to an order that exists, and the session is closed
    // pointing at a real one.
    const orders = await prisma.order.findMany()
    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    const closed = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } })

    expect(settled.status).toBe('CAPTURED')
    expect(orders.some((order) => order.id === settled.orderId)).toBe(true)
    expect(closed.status).toBe('COMPLETED')
    expect(orders.some((order) => order.id === closed.orderId)).toBe(true)
  })
})

describe('events that must not create an order', () => {
  it('ignores an event for a payment we never created', async () => {
    const outcome = await handleProviderEvent('razorpay', captured('order_never_seen', 1000))

    expect(outcome.handled).toBe(false)
    expect(await prisma.order.count()).toBe(0)
  })

  /**
   * A confirmation for a different figure than the one quoted is not a
   * confirmation of this order.
   */
  it('refuses a capture whose amount does not match the quote', async () => {
    const { payment } = await createPaidCheckout()

    await expect(
      handleProviderEvent('razorpay', captured(payment.providerPaymentId, 1)),
    ).rejects.toThrow(/amount/i)

    expect(await prisma.order.count()).toBe(0)
  })

  it('records a failure without creating an order', async () => {
    const { payment } = await createPaidCheckout()

    await handleProviderEvent('razorpay', failed(payment.providerPaymentId))

    expect(await prisma.order.count()).toBe(0)
    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(settled.status).toBe('FAILED')
  })

  /** Stock held for a payment that failed has to go back on the shelf. */
  it('releases the hold when the payment fails', async () => {
    const { payment, variant } = await createPaidCheckout()

    await handleProviderEvent('razorpay', failed(payment.providerPaymentId))

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variant.id },
    })
    expect(inventory.reservedQuantity).toBe(0)
    expect(inventory.quantity).toBe(10)
  })

  /**
   * The one case that needs a person: the stock was already given back, and now
   * the money is reported as taken. Recording the capture is right; building an
   * order on stock that may since have been sold is not.
   */
  it('records a capture that arrives after a failure but builds no order', async () => {
    const { payment, total } = await createPaidCheckout()

    await handleProviderEvent('razorpay', failed(payment.providerPaymentId))
    const outcome = await handleProviderEvent(
      'razorpay',
      captured(payment.providerPaymentId, toPaise(total)),
    )

    expect(outcome.handled).toBe(false)
    expect(await prisma.order.count()).toBe(0)

    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(settled.status).toBe('CAPTURED')
  })
})

describe('order numbers', () => {
  it('gives each order a distinct number from the sequence', async () => {
    const first = await createPaidCheckout()
    const second = await createPaidCheckout()

    await handleProviderEvent(
      'razorpay',
      captured(first.payment.providerPaymentId, toPaise(first.total)),
    )
    await handleProviderEvent(
      'razorpay',
      captured(second.payment.providerPaymentId, toPaise(second.total)),
    )

    const orders = await prisma.order.findMany({ select: { orderNumber: true } })
    expect(orders).toHaveLength(2)
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(2)
  })
})
