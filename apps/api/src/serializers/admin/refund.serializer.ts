import type { Prisma } from '@shoe/db'

/**
 * A return as the person deciding it sees it.
 *
 * Everything the customer sees is here too, plus the three things they do not:
 * who they are, what the units are worth against the order's own snapshot, and
 * how much of the parcel has actually turned up so far.
 */

export type AdminRefundRequestRecord = Prisma.RefundRequestGetPayload<{
  include: {
    order: { select: { id: true; orderNumber: true; status: true; paymentStatus: true; totalAmount: true; deliveredAt: true } }
    user: { select: { id: true; email: true; firstName: true; lastName: true } }
    decidedBy: { select: { id: true; firstName: true; lastName: true } }
    items: { include: { orderItem: true } }
    refunds: true
  }
}>

const money = (value: Prisma.Decimal) => value.toFixed(2)

const name = (person: { firstName: string | null; lastName: string | null } | null) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(' ') || null : null

function serializeItem(item: AdminRefundRequestRecord['items'][number]) {
  const received = item.restockedQuantity + item.unsellableQuantity
  return {
    id: item.id,
    orderItemId: item.orderItemId,
    /** The snapshot, like everywhere else an order line is drawn (§19). */
    title: item.orderItem.productTitle,
    sku: item.orderItem.sku,
    options: (item.orderItem.variantOptions ?? []) as { name: string; value: string }[],
    quantity: item.quantity,
    amount: money(item.amount),
    restockedQuantity: item.restockedQuantity,
    unsellableQuantity: item.unsellableQuantity,
    /** What is still owed on this line, so the receive form opens on it. */
    outstandingQuantity: Math.max(item.quantity - received, 0),
  }
}

function serializeRefund(refund: AdminRefundRequestRecord['refunds'][number]) {
  return {
    id: refund.id,
    amount: money(refund.amount),
    status: refund.status,
    provider: refund.provider,
    providerRefundId: refund.providerRefundId,
    /** Why it did not go. Staff-facing, and the reason a retry is needed. */
    failureReason: refund.failureReason,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  }
}

export function serializeAdminRefundRequest(request: AdminRefundRequestRecord) {
  return {
    id: request.id,
    type: request.type,
    status: request.status,
    reason: request.reason,
    comment: request.comment,
    estimatedAmount: money(request.estimatedAmount),
    order: {
      id: request.order.id,
      orderNumber: request.order.orderNumber,
      status: request.order.status,
      paymentStatus: request.order.paymentStatus,
      totalAmount: money(request.order.totalAmount),
      deliveredAt: request.order.deliveredAt,
    },
    customer: {
      id: request.user.id,
      email: request.user.email,
      name: name(request.user),
    },
    decidedBy: request.decidedBy ? { id: request.decidedBy.id, name: name(request.decidedBy) } : null,
    decidedAt: request.decidedAt,
    decisionNote: request.decisionNote,
    receivedAt: request.receivedAt,
    items: request.items.map(serializeItem),
    refunds: request.refunds.map(serializeRefund),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

/** The queue row: enough to triage, not enough to decide. */
export function serializeAdminRefundRequestRow(request: AdminRefundRequestRecord) {
  const full = serializeAdminRefundRequest(request)
  return {
    id: full.id,
    type: full.type,
    status: full.status,
    reason: full.reason,
    estimatedAmount: full.estimatedAmount,
    order: { id: full.order.id, orderNumber: full.order.orderNumber },
    customer: full.customer,
    itemCount: request.items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: full.createdAt,
  }
}

export type AdminRefundRequestPayload = ReturnType<typeof serializeAdminRefundRequest>
export type AdminRefundRequestRowPayload = ReturnType<typeof serializeAdminRefundRequestRow>
