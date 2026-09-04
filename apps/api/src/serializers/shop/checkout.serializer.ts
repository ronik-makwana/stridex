import { Prisma } from '@shoe/db'
import { env } from '../../config/env.js'
import { money } from './money.js'
import { serializeShopAddress } from './address.serializer.js'

/**
 * The quote, as the customer sees it. Every figure is a string the server
 * computed — the client renders these and never adds anything up (§21).
 *
 * The lines are the *snapshot*, not today's catalog: `product_title`, `sku`,
 * the option labels and `unit_price` are what was true when the session opened,
 * which is what payment charges and what the order inherits (§6, §19). A
 * repricing mid-checkout changes nothing here; it changes the next session.
 */

export type CheckoutSessionRecord = Prisma.CheckoutSessionGetPayload<{
  include: {
    items: {
      include: {
        variant: {
          include: {
            product: { select: { slug: true; media: { orderBy: { sortOrder: 'asc' }; take: 1 } } }
            media: true
          }
        }
      }
    }
    shippingAddress: true
    billingAddress: true
    redemptions: { include: { coupon: { select: { id: true; code: true; kind: true } } } }
    order: { select: { id: true; orderNumber: true } }
  }
}>

function serializeItem(item: CheckoutSessionRecord['items'][number]) {
  const options = (item.variantOptions ?? []) as { name: string; value: string }[]
  // The variant's own image when it has one, the product's cover otherwise.
  const cover = item.variant?.media ?? item.variant?.product?.media?.[0] ?? null

  return {
    id: item.id,
    variantId: item.variantId,
    /** For the link back to the product. Null if it has since been archived. */
    slug: item.variant?.product?.slug ?? null,
    image: cover ? { url: cover.url, altText: cover.altText } : null,
    title: item.productTitle,
    sku: item.sku,
    options,
    unitPrice: money(item.unitPrice),
    quantity: item.quantity,
    totalPrice: money(item.totalPrice),
    discountAmount: money(item.discountAmount),
    orderDiscountAllocated: money(item.orderDiscountAllocated),
    /**
     * The code that took money off *this* line, and what it took. Null when
     * nothing did — which is not the same as zero, and the difference is
     * whether the row says anything at all.
     */
    discount:
      item.discountCode && item.discountAmount.greaterThan(0)
        ? { code: item.discountCode, amount: money(item.discountAmount) }
        : null,
    /** What this line actually costs after its discount. */
    discountedTotal: money(item.totalPrice.minus(item.discountAmount)),
  }
}

/**
 * The delivery services, priced for *this* order. Computed by the service and
 * passed in, because both the rate and the free-delivery waiver depend on the
 * order's discounted goods total — a list of prices the client worked out for
 * itself is a list the client could get wrong (§21).
 */
export type ShippingMethodOption = {
  code: string
  label: string
  eta: string
  amount: Prisma.Decimal
}

export function serializeCheckoutSession(
  session: CheckoutSessionRecord,
  shippingMethods: ShippingMethodOption[] = [],
) {
  const itemDiscount = session.items.reduce(
    (sum, item) => sum.plus(item.discountAmount),
    new Prisma.Decimal(0),
  )
  const totalDiscount = itemDiscount
    .plus(session.discountAmount)
    .plus(session.shippingDiscount)

  return {
    id: session.id,
    status: session.status,
    /**
     * The authority on the deadline, not the countdown the UI draws from it.
     * The server rejects on this value whatever the browser was showing (§2).
     */
    expiresAt: session.expiresAt,
    items: session.items.map(serializeItem),
    subtotal: money(session.subtotal),
    discountAmount: money(session.discountAmount),
    /**
     * The codes on this checkout and what each is worth *after* allocation —
     * a code that lost every line to a better one shows zero, which is the
     * honest answer and the reason to take it off.
     */
    discounts: session.redemptions
      .filter((row) => row.status === 'ACTIVE')
      .map((row) => ({
        couponId: row.couponId,
        code: row.coupon.code,
        /**
         * Which kind, because the two are shown in different places: a product
         * discount is named against the line it came off, an order discount has
         * no line to sit on and needs a row of its own in the totals.
         */
        kind: row.coupon.kind,
        amount: money(row.discountAmount),
      })),
    /** Every saving on the order: the lines' own, plus any order-wide one. */
    totalDiscount: money(totalDiscount),
    /**
     * The lines as the item column adds up: gross less each line's own
     * discount, and *not* less the order-wide one.
     *
     * That is what the summary calls Subtotal, and it is deliberately not the
     * final figure: an order discount has no line to be shown against, so it
     * gets its own row underneath. A subtotal that had quietly absorbed it
     * would be a saving the customer cannot see anywhere.
     */
    goodsTotal: money(session.subtotal.minus(itemDiscount)),
    shippingAmount: money(session.shippingAmount),
    /** Taken off the delivery charge. The rate above stays what was quoted. */
    shippingDiscount: money(session.shippingDiscount),
    /** The chosen service, and what every service would have cost. */
    shippingMethod: session.shippingMethod,
    shippingMethods: shippingMethods.map((method) => ({
      code: method.code,
      label: method.label,
      eta: method.eta,
      amount: money(method.amount),
    })),
    totalAmount: money(session.totalAmount),
    currency: session.currency,
    shippingAddress: session.shippingAddress ? serializeShopAddress(session.shippingAddress) : null,
    billingAddress: session.billingAddress ? serializeShopAddress(session.billingAddress) : null,
    /**
     * Null until the webhook lands; its arrival is what makes this an order.
     * The number rides along because a tab still sitting on the payment screen
     * needs somewhere to redirect to, not just the knowledge that it is done.
     */
    order: session.order
      ? { id: session.order.id, orderNumber: session.order.orderNumber }
      : null,
    /**
     * Who will take the money, so the page can say so *before* Pay is pressed.
     *
     * The alternative was a build-time flag in the storefront, which is the
     * same fact written down twice and therefore a fact that will eventually
     * disagree with itself. This is the server's answer, and the server is the
     * one that decides.
     *
     * Not a secret: it is a name, not a key. What the browser needs to actually
     * pay comes back from `POST /payments` as `clientPayload` and only then.
     */
    paymentProvider: env.PAYMENT_PROVIDER,
    createdAt: session.createdAt,
  }
}

export type ShopCheckoutPayload = ReturnType<typeof serializeCheckoutSession>
