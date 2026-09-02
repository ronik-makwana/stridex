import { randomUUID } from 'node:crypto'
import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound, unprocessable } from '../../lib/errors.js'
import { applyStockMove } from '../inventory/inventory.service.js'
import {
  serializeAdminRefundRequest,
  serializeAdminRefundRequestRow,
  type AdminRefundRequestPayload,
  type AdminRefundRequestRowPayload,
} from '../../serializers/admin/refund.serializer.js'
import * as orders from '../orders/admin.orders.service.js'
import { sendReturnApproved, sendReturnRejected } from '../mail/mail.service.js'
import { logger } from '../../lib/logger.js'
import type { AdminOrderPayload } from '../../serializers/admin/order.serializer.js'
import type {
  ApproveReturnInput,
  CreateRefundInput,
  ReceiveReturnInput,
  RejectReturnInput,
  ReturnListQuery,
} from '../../schemas/admin/refund.schema.js'
import { quoteRefund, refundedSoFar, type CountedRefund } from './refund.math.js'
import { createRefundRow, keyFor, sendToProvider } from './refunds.service.js'

/**
 * The returns queue: read it, decide it, receive the parcel.
 *
 * Three writes, and they are deliberately staged. Approving costs nothing and
 * commits to nothing — the parcel is still in the customer's hall. Receiving is
 * where both irreversible things happen at once: stock goes back on the shelf
 * and money is sent, because those are the same moment in the real world and
 * splitting them would leave one of them to be remembered later.
 *
 * There is no "refund without receiving" here. That exists, it is called a
 * discretionary refund, and it belongs on the order rather than on a return
 * somebody is still waiting for (15.6).
 */

const requestInclude = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      totalAmount: true,
      deliveredAt: true,
    },
  },
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  decidedBy: { select: { id: true, firstName: true, lastName: true } },
  items: { include: { orderItem: true } },
  refunds: true,
} satisfies Prisma.RefundRequestInclude

const SORT_COLUMNS = {
  created_at: 'createdAt',
  estimated_amount: 'estimatedAmount',
} as const satisfies Record<string, keyof Prisma.RefundRequestOrderByWithRelationInput>

export async function findMany(
  query: ReturnListQuery,
): Promise<{ data: AdminRefundRequestRowPayload[]; total: number }> {
  const where: Prisma.RefundRequestWhereInput = {}
  if (query.status) where.status = query.status
  if (query.type) where.type = query.type
  if (query.q) {
    where.OR = [
      { order: { orderNumber: { contains: query.q, mode: 'insensitive' } } },
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
    ]
  }

  const [rows, total] = await prisma.$transaction([
    prisma.refundRequest.findMany({
      where,
      include: requestInclude,
      // Any non-unique sort needs a tiebreaker, or page 2 repeats a row.
      orderBy: [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.refundRequest.count({ where }),
  ])

  return { data: rows.map(serializeAdminRefundRequestRow), total }
}

export async function findById(id: string): Promise<AdminRefundRequestPayload> {
  const request = await prisma.refundRequest.findUnique({ where: { id }, include: requestInclude })
  if (!request) throw notFound('Return request')
  return serializeAdminRefundRequest(request)
}

/**
 * Yes — send it back.
 *
 * Conditional on REQUESTED, and the count is the check rather than a read
 * before it: two operators with the same queue open both click Approve, and
 * only the write can settle which of them decided it.
 */
export async function approve(
  id: string,
  input: ApproveReturnInput,
  actorId: string,
): Promise<AdminRefundRequestPayload> {
  const decided = await prisma.refundRequest.updateMany({
    where: { id, status: 'REQUESTED' },
    data: {
      status: 'APPROVED',
      decidedByUserId: actorId,
      decidedAt: new Date(),
      decisionNote: input.note,
    },
  })
  if (decided.count === 0) await throwUndecidable(id, 'approved')

  // After the write, because the email tells the customer to post a parcel —
  // and it must not go out for a decision that did not commit.
  await queueDecisionEmail(id, 'approved')

  return findById(id)
}

/** No — and the note is why, in words the customer is shown. */
export async function reject(
  id: string,
  input: RejectReturnInput,
  actorId: string,
): Promise<AdminRefundRequestPayload> {
  const decided = await prisma.refundRequest.updateMany({
    where: { id, status: 'REQUESTED' },
    data: {
      status: 'REJECTED',
      decidedByUserId: actorId,
      decidedAt: new Date(),
      decisionNote: input.note,
    },
  })
  if (decided.count === 0) await throwUndecidable(id, 'rejected')

  await queueDecisionEmail(id, 'rejected')

  return findById(id)
}

/**
 * The parcel is here.
 *
 * The one call in the system that moves stock and money in the same breath, and
 * it is a single transaction for exactly that reason: a crash between the two
 * leaves either shoes on a shelf nobody paid for or a refund for goods nobody
 * has.
 *
 * Partial and repeatable. Two of three pairs today and the third next week are
 * two receipts, two refunds and two ledger entries — which is what the
 * `restocked_quantity` columns are for, and what stops a second click paying
 * for the same pair twice.
 */
export async function receive(
  id: string,
  input: ReceiveReturnInput,
  actorId: string,
): Promise<AdminRefundRequestPayload> {
  const request = await prisma.refundRequest.findUnique({
    where: { id },
    include: {
      items: { include: { orderItem: true } },
      order: {
        include: {
          items: true,
          payments: { where: { status: 'CAPTURED' } },
          refunds: { include: { items: true } },
        },
      },
      refunds: { select: { id: true } },
    },
  })
  if (!request) throw notFound('Return request')

  if (request.status !== 'APPROVED' && request.status !== 'RECEIVED') {
    throw unprocessable(
      `A ${request.status.toLowerCase()} return cannot be received`,
      request.status === 'REQUESTED'
        ? 'Approve it first — the customer has not been told to send it yet.'
        : undefined,
    )
  }

  const byId = new Map(request.items.map((item) => [item.id, item]))

  /**
   * Every line is checked before anything is written. A receipt that took the
   * first two lines and refused the third would leave stock moved for half a
   * parcel, with no row saying which half.
   */
  const received = input.items.map((line) => {
    const item = byId.get(line.requestItemId)
    if (!item) throw notFound('Return line')

    const units = line.restockQuantity + line.unsellableQuantity
    const outstanding = item.quantity - item.restockedQuantity - item.unsellableQuantity
    if (units > outstanding) {
      throw unprocessable(
        `More ${item.orderItem.productTitle} arrived than was asked for`,
        outstanding === 0
          ? 'Every unit on this line has already been received.'
          : `${outstanding} unit${outstanding === 1 ? '' : 's'} of it ${outstanding === 1 ? 'is' : 'are'} still outstanding.`,
      )
    }
    return { item, ...line, units }
  })

  const counted: CountedRefund[] = request.order.refunds.map((row) => ({
    status: row.status,
    amount: row.amount,
    items: row.items,
  }))

  /**
   * Priced from the units that actually turned up, not from what was asked for.
   * `quoteRefund` starts from what has already gone back on each line, so two
   * receipts on one line still add up to exactly what the line cost.
   */
  const quote = quoteRefund(
    request.order,
    request.order.items,
    received
      .filter((line) => line.units > 0)
      .map((line) => ({ orderItemId: line.item.orderItemId, quantity: line.units })),
    { alreadyRefunded: counted },
  )

  const payment = request.order.payments[0]

  const refundId = await prisma.$transaction(async (tx) => {
    if (request.status === 'APPROVED') {
      const claimed = await tx.refundRequest.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      })
      // Somebody else received it in the seconds since the read. Their receipt
      // moved the stock; this one must not move it again.
      if (claimed.count === 0) throw unprocessable('This return has just been received by somebody else')
    }

    for (const line of received) {
      if (line.units === 0) continue

      await tx.refundRequestItem.update({
        where: { id: line.item.id },
        data: {
          restockedQuantity: { increment: line.restockQuantity },
          unsellableQuantity: { increment: line.unsellableQuantity },
        },
      })

      const variantId = line.item.orderItem.variantId
      // A variant deleted since the order was placed leaves the line intact —
      // it is a snapshot — but there is nothing left to put back. The refund
      // is not held up by it.
      if (!variantId) continue

      if (line.restockQuantity > 0) {
        await applyStockMove(tx, {
          variantId,
          delta: line.restockQuantity,
          type: 'RETURN',
          referenceType: 'return.received',
          referenceId: request.id,
          note: input.note,
          userId: actorId,
        })
      }

      /**
       * Two entries, not none. The parcel genuinely came back — that is a
       * RETURN — and then the units were written off, which is an ADJUSTMENT
       * with its own reason. Skipping both would leave the on-hand number right
       * and the story missing, and "where did those three pairs go" is exactly
       * the question a ledger exists to answer (15.3).
       */
      if (line.unsellableQuantity > 0) {
        await applyStockMove(tx, {
          variantId,
          delta: line.unsellableQuantity,
          type: 'RETURN',
          referenceType: 'return.received',
          referenceId: request.id,
          note: input.note,
          userId: actorId,
        })
        await applyStockMove(tx, {
          variantId,
          delta: -line.unsellableQuantity,
          type: 'ADJUSTMENT',
          referenceType: 'return.damaged',
          referenceId: request.id,
          note: input.note ?? 'Came back unsellable',
          userId: actorId,
        })
      }
    }

    if (!payment || quote.total.lessThanOrEqualTo(0)) return null

    const refund = await createRefundRow(tx, {
      orderId: request.orderId,
      paymentId: payment.id,
      amount: quote.total,
      items: quote.items,
      reason: request.reason,
      // One key per receipt, so a parcel arriving in two halves refunds twice
      // and a double-clicked button refunds once.
      idempotencyKey: keyFor.request(request.id, request.refunds.length),
      requestId: request.id,
      initiatedByUserId: actorId,
      note: input.note,
    })

    return refund.id
  })

  // Outside the transaction: a provider call inside one holds a connection open
  // across the network, and a timeout would roll back a parcel that is on the
  // shelf.
  if (refundId) await sendToProvider(refundId)

  return findById(id)
}

/**
 * Tells the customer what was decided. Swallowed on failure: the decision is
 * made and recorded, and an operator seeing a 500 would click again and meet a
 * refusal about a request that is already approved.
 */
async function queueDecisionEmail(requestId: string, decision: 'approved' | 'rejected'): Promise<void> {
  try {
    const request = await prisma.refundRequest.findUnique({
      where: { id: requestId },
      select: { user: { select: { email: true } } },
    })
    if (!request?.user.email) return

    const send = decision === 'approved' ? sendReturnApproved : sendReturnRejected
    await send({ to: request.user.email, requestId })
  } catch (error) {
    logger.error({ err: error, requestId, decision }, 'could not queue the return decision email')
  }
}

/** Why a conditional decision matched nothing — read only to explain it. */
async function throwUndecidable(id: string, verb: string): Promise<never> {
  const request = await prisma.refundRequest.findUnique({ where: { id }, select: { status: true } })
  if (!request) throw notFound('Return request')
  throw unprocessable(
    `A ${request.status.toLowerCase()} return cannot be ${verb}`,
    'Someone may have decided it while this page was open. Refresh to see.',
  )
}

/**
 * A refund an operator decided on, against no request.
 *
 * The escape hatch, and deliberately a narrow one: an amount, a reason, and a
 * note somebody has to type. It moves no stock and closes no return, because
 * nothing came back — this is money for a late delivery, a scuffed box, a
 * gesture. Goods coming home is the other flow, and conflating them would mean
 * a goodwill ₹200 quietly marked a pair as returned.
 *
 * The cap is `createRefundRow`'s, not this function's: it is the only place
 * that sees every refund on the order, in-flight ones included, and a ceiling
 * checked anywhere else is a ceiling two clicks can walk past.
 */
export async function issueDiscretionary(
  orderId: string,
  input: CreateRefundInput,
  actorId: string,
): Promise<AdminOrderPayload> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, payments: { where: { status: 'CAPTURED' }, select: { id: true } } },
  })
  if (!order) throw notFound('Order')

  const payment = order.payments[0]
  if (!payment) {
    throw unprocessable(
      'There is no settled payment on this order to refund',
      'Nothing was captured against it.',
    )
  }

  const refund = await prisma.$transaction((tx) =>
    createRefundRow(tx, {
      orderId,
      paymentId: payment.id,
      amount: new Prisma.Decimal(input.amount),
      // No lines: this is not a statement about which goods came back, and
      // inventing an attribution would let it cap a return the customer may
      // still be entitled to make.
      items: [],
      reason: input.reason,
      // Random, because refunding ₹200 twice on purpose is a real thing to
      // want — unlike cancelling an order twice, which never is.
      idempotencyKey: keyFor.manual(randomUUID()),
      initiatedByUserId: actorId,
      note: input.note,
    }),
  )

  await sendToProvider(refund.id)

  return orders.findById(orderId)
}
