import { prisma } from '../../lib/prisma.js'
import { AppError, notFound } from '../../lib/errors.js'
import { SHOP_ERROR_CODES } from '../../schemas/shop/common.schema.js'
import type { CancelOrderInput, CreateReturnInput } from '../../schemas/shop/refund.schema.js'
import { findByNumber } from '../orders/orders.service.js'
import type { ShopOrderPayload } from '../../serializers/shop/order.serializer.js'
import {
  isWithinReturnWindow,
  quoteRefund,
  refundedSoFar,
  returnableUnits,
  returnWindowEndsAt,
  type CountedRefund,
} from './refund.math.js'
import {
  createRefundRow,
  keyFor,
  releaseCoupons,
  restockCancelledOrder,
  sendToProvider,
} from './refunds.service.js'

/**
 * Cancelling your own order, before it goes anywhere.
 *
 * Self-serve on purpose. Nothing has shipped, the goods are on a shelf, and
 * making somebody email support to stop a parcel that has not moved is a
 * support ticket the system could have answered itself.
 *
 * The window is the fulfilment status and nothing else: PENDING or PROCESSING.
 * Once it is with a courier it is a return, which is a different set of rules
 * and a different amount (15.5).
 */

/** Open means somebody still owes somebody an answer or a parcel. */
const OPEN_STATUSES = ['REQUESTED', 'APPROVED', 'RECEIVED'] as const

const CANCELLABLE = ['PENDING', 'PROCESSING'] as const

export async function cancelOrder(
  userId: string,
  orderNumber: string,
  input: CancelOrderInput,
): Promise<ShopOrderPayload> {
  // Scoped in the `where`, never read-then-check: another customer's order
  // number is a 404 rather than a 403 that confirms it exists (§22).
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId },
    include: {
      items: true,
      payments: { where: { status: 'CAPTURED' } },
      refunds: { include: { items: true } },
      refundRequests: { where: { status: { in: [...OPEN_STATUSES] } }, select: { id: true } },
    },
  })
  if (!order) throw notFound('Order')

  if (order.refundRequests.length > 0) {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.REFUND_ALREADY_REQUESTED,
      'There is already a request open on this order',
      { reason: 'Open the order to see where it has got to.' },
    )
  }

  if (!(CANCELLABLE as readonly string[]).includes(order.status)) {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.ORDER_NOT_CANCELLABLE,
      cannotCancelMessage(order.status),
      { reason: cannotCancelReason(order.status) },
    )
  }

  const counted: CountedRefund[] = order.refunds.map((row) => ({
    status: row.status,
    amount: row.amount,
    items: row.items,
  }))

  /**
   * Everything, including delivery. The parcel never went, so the courier
   * charge goes back with the goods — the one case where it does (15.2).
   */
  const quote = quoteRefund(
    order,
    order.items,
    order.items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
    { includeShipping: true, alreadyRefunded: counted },
  )

  // An order created by the webhook always has a captured payment. Guarded
  // anyway: cancelling is still the right answer for an order with no money
  // behind it, and refunding nothing is better than refusing to cancel.
  const payment = order.payments[0]

  const refundId = await prisma.$transaction(async (tx) => {
    /**
     * The conditional write, and the whole reason a cancellation is safe.
     *
     * Between the check above and this line a warehouse operator may have hit
     * "Shipped". If they did, this matches nothing, and the customer is told
     * the parcel is on its way instead of getting a refund on goods that have
     * left the building.
     */
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: [...CANCELLABLE] } },
      data: { status: 'CANCELLED' },
    })
    if (claimed.count === 0) {
      throw new AppError(
        409,
        SHOP_ERROR_CODES.ORDER_NOT_CANCELLABLE,
        'This order has just been sent out',
        { reason: 'It moved while you were on this page. Refresh to see where it is.' },
      )
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        // The customer, by name. A cancellation nobody can account for is how
        // "who cancelled this?" becomes unanswerable.
        changedByUserId: userId,
        note: `Cancelled by the customer — ${input.reason.toLowerCase().replace(/_/g, ' ')}`,
      },
    })

    /**
     * The paper trail, written even though nobody has to approve it. Both roads
     * to a refund leave the same record, so the returns queue is one place to
     * read what was asked for and what happened — rather than two.
     *
     * RECEIVED immediately, because there is no parcel to wait for: the goods
     * are already where they would be sent back to.
     */
    const request = await tx.refundRequest.create({
      data: {
        orderId: order.id,
        userId,
        type: 'CANCELLATION',
        status: payment ? 'RECEIVED' : 'COMPLETED',
        reason: input.reason,
        comment: input.comment,
        estimatedAmount: quote.total,
        receivedAt: new Date(),
        items: {
          create: quote.items.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
            amount: item.amount,
            // Nothing was ever unsellable: it never left the shelf.
            restockedQuantity: item.quantity,
          })),
        },
      },
    })

    // Stock and coupons go back here, in the same transaction as the
    // cancellation. Neither waits for the provider: they are facts about this
    // warehouse and this customer's account, not about a bank (15.3).
    await restockCancelledOrder(tx, order.id, userId)
    await releaseCoupons(tx, order.id)

    if (!payment) return null

    const refund = await createRefundRow(tx, {
      orderId: order.id,
      paymentId: payment.id,
      amount: quote.total,
      items: quote.items,
      reason: input.reason,
      // Derived: an order can only be cancelled once, so a second attempt
      // collides on the unique index rather than sending money twice.
      idempotencyKey: keyFor.cancellation(order.id),
      requestId: request.id,
      // Null: the customer asked, but nobody at the store decided anything.
      initiatedByUserId: null,
    })

    return refund.id
  })

  // Outside the transaction, deliberately: a provider call inside one holds a
  // connection open across the network, and a timeout would roll back a
  // cancellation that has already happened in the warehouse.
  if (refundId) await sendToProvider(refundId)

  return findByNumber(userId, orderNumber)
}

function cannotCancelMessage(status: string): string {
  if (status === 'SHIPPED') return 'This order is already on its way'
  if (status === 'DELIVERED') return 'This order has already been delivered'
  if (status === 'CANCELLED') return 'This order is already cancelled'
  if (status === 'REFUNDED') return 'This order has already been refunded'
  return 'This order can no longer be cancelled'
}

function cannotCancelReason(status: string): string | undefined {
  if (status === 'SHIPPED') return 'You can return it once it arrives.'
  if (status === 'DELIVERED') return 'Return it instead — the option is on this page.'
  return undefined
}

// ─── returns ─────────────────────────────────────────────────────────────────

/**
 * Asking to send part of a delivered order back.
 *
 * Nothing here moves money or stock. A request is a conversation: the customer
 * says what is coming back and why, somebody at the store agrees, and the
 * parcel then has to actually arrive. Refunding on the strength of the asking
 * would mean paying for goods that may never be posted (15.5).
 *
 * The window is counted from `delivered_at` and recomputed on every call, so a
 * store that extends returns to fourteen days extends them for orders already
 * out there — and a client that cached "returnable" an hour ago is corrected
 * here rather than believed.
 */
export async function requestReturn(
  userId: string,
  orderNumber: string,
  input: CreateReturnInput,
): Promise<ShopOrderPayload> {
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId },
    include: {
      items: true,
      payments: { where: { status: 'CAPTURED' } },
      refunds: { include: { items: true } },
      refundRequests: { where: { status: { in: [...OPEN_STATUSES] } }, select: { id: true } },
    },
  })
  if (!order) throw notFound('Order')

  if (order.refundRequests.length > 0) {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.REFUND_ALREADY_REQUESTED,
      'There is already a request open on this order',
      { reason: 'Open the order to see where it has got to.' },
    )
  }

  const settings = await prisma.storeSettings.findUnique({ where: { id: 'store' } })
  const windowDays = settings?.returnWindowDays ?? 7

  if (order.status !== 'DELIVERED') {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.RETURN_WINDOW_CLOSED,
      order.status === 'SHIPPED'
        ? 'This order has not arrived yet'
        : 'This order cannot be returned',
      {
        reason:
          order.status === 'SHIPPED'
            ? `You can send it back within ${windowDays} days of it arriving.`
            : undefined,
      },
    )
  }

  if (!isWithinReturnWindow(order.deliveredAt, windowDays)) {
    const closed = returnWindowEndsAt(order.deliveredAt, windowDays)
    throw new AppError(
      409,
      SHOP_ERROR_CODES.RETURN_WINDOW_CLOSED,
      `The ${windowDays}-day return window has closed`,
      {
        reason: closed
          ? `It ran out on ${closed.toISOString().slice(0, 10)}. Contact us if something is wrong with the order.`
          : undefined,
      },
    )
  }

  const counted: CountedRefund[] = order.refunds.map((row) => ({
    status: row.status,
    amount: row.amount,
    items: row.items,
  }))
  const { unitsByLine } = refundedSoFar(counted)
  const byId = new Map(order.items.map((item) => [item.id, item]))

  /**
   * Every line is checked before anything is written, and a bad one refuses the
   * whole request rather than being quietly dropped. A customer who ticked
   * three items and got two back with no explanation would reasonably think the
   * third is still coming.
   */
  for (const selection of input.items) {
    const line = byId.get(selection.orderItemId)
    if (!line) throw notFound('Item')

    const left = returnableUnits(line, unitsByLine)
    if (selection.quantity > left) {
      throw new AppError(
        409,
        SHOP_ERROR_CODES.QUANTITY_EXCEEDED,
        left === 0
          ? `${line.productTitle} has already been returned`
          : `You can send back at most ${left} of ${line.productTitle}`,
        { reason: 'Some of this order has already gone back.' },
      )
    }
  }

  /**
   * Goods only. The delivery was performed and consumed — the courier is not
   * refunding us because the shoes did not fit (15.2).
   */
  const quote = quoteRefund(order, order.items, input.items, { alreadyRefunded: counted })
  if (quote.items.length === 0 || quote.total.lessThanOrEqualTo(0)) {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.RETURN_WINDOW_CLOSED,
      'There is nothing left to return on this order',
    )
  }

  await prisma.refundRequest.create({
    data: {
      orderId: order.id,
      userId,
      type: 'RETURN',
      // The one place a request starts as a question rather than a fact.
      status: 'REQUESTED',
      reason: input.reason,
      comment: input.comment,
      estimatedAmount: quote.total,
      items: {
        create: quote.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          amount: item.amount,
        })),
      },
    },
  })

  return findByNumber(userId, orderNumber)
}

/**
 * Changing your mind about changing your mind.
 *
 * Only while it is still REQUESTED. Once somebody has approved it there may be
 * a courier booked and a label printed, and withdrawing it from a phone would
 * leave the warehouse expecting a parcel that is not coming — which is what
 * support is for.
 *
 * Conditional, and the count is the check: two taps on Withdraw both pass a
 * read, and only the write can settle which one is real.
 */
export async function withdrawReturn(
  userId: string,
  orderNumber: string,
  requestId: string,
): Promise<ShopOrderPayload> {
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId },
    select: { id: true },
  })
  if (!order) throw notFound('Order')

  const withdrawn = await prisma.refundRequest.updateMany({
    // Scoped by order *and* user: a request id from somebody else's order must
    // not be withdrawable by whoever guessed it.
    where: { id: requestId, orderId: order.id, userId, status: 'REQUESTED' },
    data: { status: 'WITHDRAWN' },
  })

  if (withdrawn.count === 0) {
    const exists = await prisma.refundRequest.findFirst({
      where: { id: requestId, orderId: order.id, userId },
      select: { status: true },
    })
    if (!exists) throw notFound('Return request')
    throw new AppError(
      409,
      SHOP_ERROR_CODES.REFUND_ALREADY_REQUESTED,
      'This request can no longer be withdrawn',
      { reason: `It has already been ${exists.status.toLowerCase()}.` },
    )
  }

  return findByNumber(userId, orderNumber)
}
