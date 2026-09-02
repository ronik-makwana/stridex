import type { Prisma } from '@shoe/db'
import { money } from './money.js'
import { labelFor } from '../../modules/checkout/shipping.methods.js'
import {
  isWithinReturnWindow,
  refundedSoFar,
  returnableUnits,
  returnWindowEndsAt,
  type CountedRefund,
} from '../../modules/refunds/refund.math.js'

/**
 * An order, as the customer who placed it sees it.
 *
 * **Every line here is a snapshot.** Title, SKU, options and price were copied
 * out of the checkout when it was paid for, and nothing on this page joins to
 * today's catalog — which is what lets an order render correctly years later,
 * after the product has been renamed, repriced or archived (§19).
 *
 * Two status fields, because they answer different questions: where the parcel
 * is, and whether the money settled (§11).
 */

export type ShopOrderRecord = Prisma.OrderGetPayload<{
  include: {
    items: { include: { variant: { select: { product: { select: { slug: true; media: { take: 1 } } } } } } }
    addresses: true
    statusHistory: true
    payments: true
    couponRedemptions: { include: { coupon: { select: { code: true; kind: true } } } }
    refunds: { include: { items: true } }
    refundRequests: { include: { items: true } }
  }
}>

/**
 * The codes that were actually spent, one line each.
 *
 * `kind` is what the customer needs to make sense of two discounts on one
 * order: SAVE10 came off the shoes, FREESHIP came off the delivery, and a
 * single merged "Discount −₹474.60" makes that unanswerable.
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
function goodsTotal(order: ShopOrderRecord): Prisma.Decimal {
  return order.items.reduce((total, item) => total.minus(item.discountAmount), order.subtotal)
}

function serializeDiscounts(order: ShopOrderRecord) {
  return order.couponRedemptions.map((redemption) => ({
    code: redemption.coupon.code,
    kind: redemption.coupon.kind,
    amount: money(redemption.discountAmount),
  }))
}

/**
 * What the timeline draws. Internal notes and the staff member stay in admin.
 *
 * CANCELLED and REFUNDED are on the list: they are the two entries a customer
 * most wants dated, and leaving them off meant an order could go quiet with the
 * page still showing "delivered" as the last thing that happened.
 */
const CUSTOMER_FACING_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const

/** Somebody still owes somebody an answer or a parcel. */
const OPEN_REQUEST_STATUSES = ['REQUESTED', 'APPROVED', 'RECEIVED'] as const

const CANCELLABLE_STATUSES = ['PENDING', 'PROCESSING'] as const

/**
 * A refund, as the person waiting for it sees it.
 *
 * The provider's id, the internal note and who issued it stay in admin. What is
 * left is the only thing the customer asked: how much, and has it left yet.
 */
function serializeRefunds(order: ShopOrderRecord) {
  return order.refunds
    // A refund that failed at the provider is not the customer's business to
    // read as a line item — it is staff work, and showing "failed" beside an
    // amount they are still owed reads as "you are not getting this".
    .filter((refund) => refund.status !== 'FAILED')
    .map((refund) => ({
      id: refund.id,
      amount: money(refund.amount),
      /** PENDING and PROCESSING both mean "on its way"; the UI phrases it. */
      status: refund.status,
      reason: refund.reason,
      requestedAt: refund.createdAt,
      settledAt: refund.status === 'SUCCEEDED' ? refund.updatedAt : null,
    }))
}

function serializeItem(
  item: ShopOrderRecord['items'][number],
  unitsRefunded: Map<string, number>,
) {
  const cover = item.variant?.product?.media?.[0]
  return {
    id: item.id,
    /** Null once the variant is gone. The line still renders — it is a snapshot. */
    slug: item.variant?.product?.slug ?? null,
    image: cover ? { url: cover.url, altText: cover.altText } : null,
    title: item.productTitle,
    sku: item.sku,
    options: (item.variantOptions ?? []) as { name: string; value: string }[],
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
    /**
     * How many of these may still be sent back — quantity less whatever has
     * already been refunded, in-flight refunds included. The return form reads
     * this rather than `quantity`, or a customer could ask for the same pair
     * twice while the first refund is still settling.
     */
    returnableQuantity: returnableUnits(item, unitsRefunded),
  }
}

/**
 * `returnWindowDays` is passed in rather than read here: a serializer that
 * queried the database would do it once per row on the orders list. The caller
 * reads the single settings row once and hands it down.
 */
export function serializeShopOrder(order: ShopOrderRecord, returnWindowDays = 7) {
  const shipping = order.addresses.find((address) => address.type === 'SHIPPING')
  // The one that settled, if any — a failed attempt is not what to show.
  const paid = order.payments.find((payment) => payment.status === 'CAPTURED')

  const counted: CountedRefund[] = order.refunds.map((refund) => ({
    status: refund.status,
    amount: refund.amount,
    items: refund.items,
  }))
  const openRequest = order.refundRequests.find((request) =>
    (OPEN_REQUEST_STATUSES as readonly string[]).includes(request.status),
  )
  const { unitsByLine } = refundedSoFar(counted)
  const windowEndsAt = returnWindowEndsAt(order.deliveredAt, returnWindowDays)

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt,
    items: order.items.map((item) => serializeItem(item, unitsByLine)),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: money(order.subtotal),
    discountAmount: money(order.discountAmount),
    goodsTotal: money(goodsTotal(order)),
    /** The part of `discountAmount` that came off delivery rather than goods. */
    shippingDiscount: money(order.shippingDiscount),
    discounts: serializeDiscounts(order),
    shippingAmount: money(order.shippingAmount),
    /** The service that was paid for, resolved to its label. */
    shippingMethod: labelFor(order.shippingMethod),
    // No tax row. `orders.tax_amount` exists, is written zero, and is never
    // rendered — see the 15.0 migration.
    totalAmount: money(order.totalAmount),
    currency: order.currency,
    shippingAddress: shipping
      ? {
          fullName: shipping.fullName,
          phone: shipping.phone,
          addressLine1: shipping.addressLine1,
          addressLine2: shipping.addressLine2,
          city: shipping.city,
          state: shipping.state,
          postalCode: shipping.postalCode,
          country: shipping.country,
        }
      : null,
    payment: paid
      ? { provider: paid.provider, method: paid.method, amount: money(paid.amount), paidAt: paid.updatedAt }
      : null,
    /**
     * Customer-facing entries only, oldest first. A cancellation or a refund
     * appears as the status it is; a staff note does not appear at all.
     */
    /**
     * Whether the button is drawn — decided here, not in the browser.
     *
     * The client cannot work this out from `status` alone without knowing the
     * rules, and a client that knows the rules is a second copy of them (§21).
     * It is still only a hint: the endpoint re-checks with a conditional write,
     * because the parcel can ship in the seconds after this was rendered.
     */
    cancellable:
      (CANCELLABLE_STATUSES as readonly string[]).includes(order.status) && !openRequest,
    /**
     * Three conditions, all of which the server owns: it arrived, the window is
     * still open, and there are units nobody has already sent back. The client
     * draws a button from this and never computes it — the deadline is
     * recomputed from `delivered_at` on every read, so today's rule applies to
     * orders placed under yesterday's.
     */
    returnable:
      order.status === 'DELIVERED' &&
      isWithinReturnWindow(order.deliveredAt, returnWindowDays) &&
      !openRequest &&
      order.items.some((item) => returnableUnits(item, unitsByLine) > 0),
    /** Null until something is delivered — which is not the same as "closed". */
    returnWindowEndsAt: windowEndsAt,
    deliveredAt: order.deliveredAt,
    /** What is open, so the page can say "we have your request" instead of a form. */
    activeRequest: openRequest
      ? {
          id: openRequest.id,
          type: openRequest.type,
          status: openRequest.status,
          reason: openRequest.reason,
          amount: money(openRequest.estimatedAmount),
          requestedAt: openRequest.createdAt,
        }
      : null,
    refunds: serializeRefunds(order),
    /** Settled and in-flight together: what the customer is getting back. */
    refundedTotal: money(refundedSoFar(counted).amount),
    timeline: order.statusHistory
      .filter((entry) => (CUSTOMER_FACING_STATUSES as readonly string[]).includes(entry.toStatus))
      .map((entry) => ({ status: entry.toStatus, at: entry.createdAt }))
      .sort((a, b) => a.at.getTime() - b.at.getTime()),
    createdAt: order.createdAt,
  }
}

/** The card in the history list: enough to recognise an order, not to audit it. */
export function serializeShopOrderCard(order: ShopOrderRecord, returnWindowDays = 7) {
  const full = serializeShopOrder(order, returnWindowDays)
  return {
    id: full.id,
    orderNumber: full.orderNumber,
    status: full.status,
    paymentStatus: full.paymentStatus,
    placedAt: full.placedAt,
    itemCount: full.itemCount,
    totalAmount: full.totalAmount,
    refundedTotal: full.refundedTotal,
    /** So the history list can badge "return open" without a second request. */
    activeRequest: full.activeRequest,
    /** Three thumbnails at most — the row is a reminder, not an inventory. */
    thumbnails: full.items.slice(0, 3).map((item) => item.image),
    createdAt: full.createdAt,
  }
}

export type ShopOrderPayload = ReturnType<typeof serializeShopOrder>
export type ShopOrderCardPayload = ReturnType<typeof serializeShopOrderCard>
