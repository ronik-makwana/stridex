import { Prisma, type OrderStatus } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeAdminOrder,
  serializeAdminOrderRow,
  type AdminOrderPayload,
  type AdminOrderRowPayload,
} from '../../serializers/admin/order.serializer.js'
import type { OrderListQuery, UpdateOrderStatusInput } from '../../schemas/admin/order.schema.js'
import { assertTransition } from './order-status.js'
import { sendOrderShipped } from '../mail/mail.service.js'
import { logger } from '../../lib/logger.js'

/**
 * Orders, from the other side of the counter.
 *
 * Read-heavy by design: the only thing an operator may change here is where the
 * parcel is. Payment status is not editable — it is what the provider said, and
 * it arrives through the webhook (§8, §12). An admin who could mark an order
 * paid could mark an unpaid order paid.
 */

/**
 * Exported because `customers.service.ts` renders orders through the same
 * serializer. It used to keep its own copy of this shape, which is how adding
 * one relation here broke a screen over there — a serializer and its include
 * are one thing and belong in one place.
 */
export const orderInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  items: true,
  addresses: true,
  couponRedemptions: {
    where: { status: 'CONSUMED' },
    include: { coupon: { select: { code: true, kind: true } } },
    orderBy: { createdAt: 'asc' },
  },
  statusHistory: {
    include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
  },
  payments: true,
} satisfies Prisma.OrderInclude

const SORT_COLUMNS = {
  created_at: 'createdAt',
  placed_at: 'placedAt',
  total_amount: 'totalAmount',
  order_number: 'orderNumber',
} as const satisfies Record<string, keyof Prisma.OrderOrderByWithRelationInput>

function buildWhere(query: OrderListQuery): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {}

  if (query.status) where.status = query.status
  if (query.paymentStatus) where.paymentStatus = query.paymentStatus

  if (query.q) {
    // An operator types whatever the customer said on the phone: the order
    // number off an email, a surname, or the address they signed up with.
    where.OR = [
      { orderNumber: { contains: query.q, mode: 'insensitive' } },
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
      { user: { firstName: { contains: query.q, mode: 'insensitive' } } },
      { user: { lastName: { contains: query.q, mode: 'insensitive' } } },
    ]
  }

  if (query.from || query.to) {
    const range: Prisma.DateTimeFilter = {}
    if (query.from) range.gte = new Date(`${query.from}T00:00:00.000Z`)
    // Inclusive: "to 5 September" means everything that happened that day.
    if (query.to) range.lte = new Date(`${query.to}T23:59:59.999Z`)
    where.createdAt = range
  }

  return where
}

export async function findMany(
  query: OrderListQuery,
): Promise<{ data: AdminOrderRowPayload[]; total: number }> {
  const where = buildWhere(query)
  const orderBy: Prisma.OrderOrderByWithRelationInput[] = [
    { [SORT_COLUMNS[query.sort.field]]: query.sort.direction },
  ]
  // Any non-unique sort needs a tiebreaker, or page 2 repeats a row from page 1.
  if (query.sort.field !== 'order_number') orderBy.push({ orderNumber: 'desc' })

  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ])

  return { data: rows.map(serializeAdminOrderRow), total }
}

export async function findById(id: string): Promise<AdminOrderPayload> {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude })
  if (!order) throw notFound('Order')
  return serializeAdminOrder(order)
}

/**
 * The one write. Two rows in one transaction — the order and its history —
 * because a status change nobody can account for is how "who marked this
 * shipped?" becomes unanswerable.
 *
 * Stock is deliberately untouched, including on a cancellation. The units left
 * when the order was paid for, and putting them back is a decision with a
 * physical fact behind it: did the parcel come back, was it never packed, was
 * it lost. An operator makes that call on the inventory screen, where the
 * ledger records a reason.
 */
export async function updateStatus(
  id: string,
  input: UpdateOrderStatusInput,
  actorId: string,
): Promise<AdminOrderPayload> {
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!order) throw notFound('Order')

  assertTransition(order.status, input.status)

  const [, history] = await prisma.$transaction([
    prisma.order.update({ where: { id }, data: { status: input.status } }),
    prisma.orderStatusHistory.create({
      data: {
        orderId: id,
        fromStatus: order.status as OrderStatus,
        toStatus: input.status,
        note: input.note,
        changedByUserId: actorId,
      },
    }),
  ])

  if (input.status === 'SHIPPED') await queueShippedEmail(id, history.id)

  return findById(id)
}

/** The timeline on its own, for a screen that only wants the history. */
export async function history(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true } })
  if (!order) throw notFound('Order')

  const rows = await prisma.orderStatusHistory.findMany({
    where: { orderId: id },
    include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return rows.map((entry) => ({
    id: entry.id,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    note: entry.note,
    changedBy: entry.changedBy
      ? {
          id: entry.changedBy.id,
          name: [entry.changedBy.firstName, entry.changedBy.lastName].filter(Boolean).join(' ') || null,
        }
      : null,
    createdAt: entry.createdAt,
  }))
}

/**
 * Queues the "on its way" email, after the transaction rather than inside it.
 *
 * Keyed on the **history row**, not the order. `order-status.ts` allows
 * SHIPPED → PROCESSING so an operator can correct a mistake and ship again, and
 * an order-keyed job id would make that second, entirely real shipment send
 * nothing at all. Each transition writes its own history row, so that row is
 * the event.
 *
 * Failures are logged, not thrown: the status change is done and correct, and
 * an operator should not see a 500 — and be tempted to click again — because a
 * queue blinked.
 */
async function queueShippedEmail(orderId: string, statusHistoryId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { user: { select: { email: true } } },
    })
    if (!order?.user?.email) return

    await sendOrderShipped({ to: order.user.email, orderId, statusHistoryId })
  } catch (error) {
    logger.error({ err: error, orderId }, 'could not queue shipped email')
  }
}
