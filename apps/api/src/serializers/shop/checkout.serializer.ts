import type { Prisma } from '@shoe/db'
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
    items: { include: { variant: { include: { product: { select: { slug: true } }; media: true } } } }
    shippingAddress: true
    billingAddress: true
  }
}>

function serializeItem(item: CheckoutSessionRecord['items'][number]) {
  const options = (item.variantOptions ?? []) as { name: string; value: string }[]
  const cover = item.variant?.media

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
    /** Both zero until 15.3 hangs coupons off them. */
    discountAmount: money(item.discountAmount),
    orderDiscountAllocated: money(item.orderDiscountAllocated),
  }
}

export function serializeCheckoutSession(session: CheckoutSessionRecord) {
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
    shippingAmount: money(session.shippingAmount),
    totalAmount: money(session.totalAmount),
    currency: session.currency,
    shippingAddress: session.shippingAddress ? serializeShopAddress(session.shippingAddress) : null,
    billingAddress: session.billingAddress ? serializeShopAddress(session.billingAddress) : null,
    /** Null until the webhook lands. Its arrival is what makes this an order. */
    orderId: session.orderId,
    createdAt: session.createdAt,
  }
}

export type ShopCheckoutPayload = ReturnType<typeof serializeCheckoutSession>
