import type { Prisma } from '@shoe/db'
import { allowedTransitions } from '../../modules/orders/order-status.js'
import { labelFor } from '../../modules/checkout/shipping.methods.js'

/**
 * The admin's view of an order. It differs from the customer's in what it is
 * allowed to show, not in where the numbers come from: both render the
 * `order_items` snapshots, because the price on an order is what was charged,
 * not what the product costs today (§19).
 *
 * What admin gets extra: who placed it, both addresses, the full status history
 * including who changed it and why, and every payment attempt rather than only
 * the one that settled.
 */

const money = (value: Prisma.Decimal): string => value.toFixed(2)

export type AdminOrderRecord = Prisma.OrderGetPayload<{
  include: {
    user: { select: { id: true; email: true; firstName: true; lastName: true } }
    items: true
    addresses: true
    statusHistory: { include: { changedBy: { select: { id: true; firstName: true; lastName: true } } } }
    payments: true
    couponRedemptions: { include: { coupon: { select: { code: true; kind: true } } } }
  }
}>

/**
 * The codes spent on this order, one line each with what it took off.
 *
 * Admin needs the breakdown for the same reason support does: "why is this
 * order ₹474.60 cheaper than its items" has to be answerable without opening
 * the coupon table and reasoning about which rules were live that day.
 */
/**
 * The lines as the item column adds up: gross less each line's **own**
 * discount, and *not* less the order-wide one — the same definition the
 * checkout summary calls Subtotal.
 *
 * An order-wide discount has no line to be shown against, so it gets its own
 * row underneath. A subtotal that had quietly absorbed it would be a saving the
 * customer can see nowhere, and an order page that disagreed with the checkout
 * they just read.
 */
function goodsTotal(order: AdminOrderRecord): Prisma.Decimal {
  return order.items.reduce((total, item) => total.minus(item.discountAmount), order.subtotal)
}

function serializeDiscounts(order: AdminOrderRecord) {
  return order.couponRedemptions.map((redemption) => ({
    code: redemption.coupon.code,
    kind: redemption.coupon.kind,
    amount: money(redemption.discountAmount),
  }))
}

const customerOf = (order: AdminOrderRecord) =>
  order.user
    ? {
        id: order.user.id,
        email: order.user.email,
        name: [order.user.firstName, order.user.lastName].filter(Boolean).join(' ') || null,
      }
    : null

export function serializeAdminOrderRow(order: AdminOrderRecord) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    /** Two columns in the list, deliberately. */
    status: order.status,
    paymentStatus: order.paymentStatus,
    customer: customerOf(order),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: money(order.totalAmount),
    currency: order.currency,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
  }
}

export function serializeAdminOrder(order: AdminOrderRecord) {
  const address = (type: 'SHIPPING' | 'BILLING') => {
    const row = order.addresses.find((entry) => entry.type === type)
    if (!row) return null
    return {
      fullName: row.fullName,
      phone: row.phone,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
    }
  }

  return {
    ...serializeAdminOrderRow(order),

    items: order.items.map((item) => ({
      id: item.id,
      /** Null when the variant has since been deleted. The line is a snapshot. */
      variantId: item.variantId,
      productTitle: item.productTitle,
      sku: item.sku,
      variantOptions: (item.variantOptions ?? []) as { name: string; value: string }[],
      unitPrice: money(item.unitPrice),
      quantity: item.quantity,
      totalPrice: money(item.totalPrice),
      discountAmount: money(item.discountAmount),
      /**
       * The line as charged: its own discount off, the order-wide share not.
       * Computed here in Decimal rather than subtracted in the browser — two
       * floats and a currency is how a row renders ₹4,023.1999999.
       */
      discountedTotal: money(item.totalPrice.minus(item.discountAmount)),
      /** Snapshot of the code that discounted this line, if any. */
      discountCode: item.discountCode,
      orderDiscountAllocated: money(item.orderDiscountAllocated),
    })),

    subtotal: money(order.subtotal),
    discountAmount: money(order.discountAmount),
    goodsTotal: money(goodsTotal(order)),
    shippingDiscount: money(order.shippingDiscount),
    discounts: serializeDiscounts(order),
    shippingAmount: money(order.shippingAmount),
    /** The service that was paid for, resolved to its label. */
    shippingMethod: labelFor(order.shippingMethod),
    /** Always zero and never rendered — kept because the column is still there. */
    taxAmount: money(order.taxAmount),

    shippingAddress: address('SHIPPING'),
    billingAddress: address('BILLING'),

    /** Every attempt, not just the one that worked: a decline is worth seeing. */
    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      method: payment.method,
      amount: money(payment.amount),
      status: payment.status,
      createdAt: payment.createdAt,
    })),

    /** Newest first: what happened last is what an operator is looking for. */
    history: [...order.statusHistory]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        note: entry.note,
        // Null for the rows the webhook writes. 'system' is the honest label.
        changedBy: entry.changedBy
          ? {
              id: entry.changedBy.id,
              name:
                [entry.changedBy.firstName, entry.changedBy.lastName].filter(Boolean).join(' ') ||
                null,
            }
          : null,
        createdAt: entry.createdAt,
      })),

    /**
     * Served rather than hard-coded in the client: the machine lives in one
     * place, and a modal that offers a transition the service will refuse is a
     * modal that lies.
     */
    allowedTransitions: allowedTransitions(order.status),

    updatedAt: order.updatedAt,
  }
}

export type AdminOrderPayload = ReturnType<typeof serializeAdminOrder>
export type AdminOrderRowPayload = ReturnType<typeof serializeAdminOrderRow>
