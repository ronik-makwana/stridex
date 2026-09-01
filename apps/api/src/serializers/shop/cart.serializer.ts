import type { Prisma } from '@shoe/db'
import { discountPercent, money, moneyOrNull } from './money.js'
import {
  MAX_QUANTITY_PER_ITEM,
  availableQuantity,
  purchasableQuantity,
  stockBucket,
  type StockBucket,
} from './stock.serializer.js'
import { SHOP_ERROR_CODES, type ShopErrorCode } from '../../schemas/shop/common.schema.js'

/**
 * A cart line is the one payload in the storefront that has to say *why* it is
 * not what the customer left it as. A bag that quietly repriced itself, or
 * quietly dropped a line, is how someone arrives at checkout arguing about a
 * number — so every adjustment carries a reason, attached to the line it
 * happened to rather than to a page-level "some items changed" banner nobody
 * can act on (§16).
 */

export type CartLineReason = {
  code: ShopErrorCode
  /** Rendered verbatim above the line. One sentence, no icon soup. */
  message: string
  /** PRICE_CHANGED only — what the customer last saw, struck through. */
  previousPrice?: string
  /** OUT_OF_STOCK / QUANTITY_EXCEEDED — what they asked for before the clamp. */
  requestedQuantity?: number
}

export type CartVariantRecord = Prisma.ProductVariantGetPayload<{
  include: {
    inventory: true
    product: {
      include: {
        brand: { select: { id: true; name: true; slug: true } }
        media: { orderBy: { sortOrder: 'asc' }; take: 1 }
      }
    }
    optionAssignments: { include: { optionValue: { include: { variantOption: true } } } }
  }
}>

/**
 * 'Black / UK 9'. Built from the variant's own option assignments in the
 * product's axis order, so a cart line reads the way the picker did.
 */
function optionLabel(variant: CartVariantRecord): { name: string; value: string }[] {
  return [...variant.optionAssignments]
    .sort((a, b) => (a.optionValue.variantOption?.name ?? '').localeCompare(b.optionValue.variantOption?.name ?? ''))
    .map((assignment) => ({
      name: assignment.optionValue.variantOption?.name ?? '',
      value: assignment.optionValue.value,
    }))
}

/**
 * A line whose variant no longer resolves at all — deleted, or an id from a
 * localStorage cart older than the catalog. There is nothing to show but the
 * fact that it is gone, and the only action is Remove.
 */
export function unknownCartLine(variantId: string, quantity: number) {
  return {
    /** The authed cart's row id. Null for a guest line, which has no row. */
    id: null as string | null,
    variantId,
    productId: null as string | null,
    slug: null as string | null,
    title: null as string | null,
    brand: null as { id: string; name: string; slug: string } | null,
    image: null as { url: string; altText: string | null } | null,
    sku: null as string | null,
    options: [] as { name: string; value: string }[],
    price: null as string | null,
    compareAtPrice: null as string | null,
    discountPercent: null as number | null,
    quantity,
    lineTotal: null as string | null,
    stock: 'SOLD_OUT' as StockBucket,
    maxQuantity: 0,
    /** False means: this line cannot go to checkout, and only Remove is offered. */
    purchasable: false,
    reason: {
      code: SHOP_ERROR_CODES.PRODUCT_UNAVAILABLE,
      message: 'This item is no longer available',
    } as CartLineReason | null,
  }
}

export type CartLine = ReturnType<typeof unknownCartLine>

/**
 * Prices the line against today's catalog and reports what had to change.
 *
 * Only one reason is returned, worst first: a line that is both unavailable and
 * repriced is unavailable, and stacking two warnings on one row is how a
 * customer stops reading either.
 */
export function serializeCartLine(
  variant: CartVariantRecord,
  requested: { id?: string; quantity: number; priceSeen?: string | null },
): CartLine {
  const product = variant.product
  const inventory = variant.inventory
  const available = availableQuantity(inventory)
  const cover = product.media[0]

  const sellable = variant.status === 'ACTIVE' && product.status === 'ACTIVE'
  const price = money(variant.price)

  let quantity = requested.quantity
  let reason: CartLineReason | null = null

  // What this line may hold: whichever runs out first, the stock or the limit.
  // `purchasableQuantity` is the same ceiling the stepper is given, so the two
  // cannot disagree about what is offerable.
  const ceiling = purchasableQuantity(inventory)

  if (!sellable) {
    reason = {
      code: SHOP_ERROR_CODES.PRODUCT_UNAVAILABLE,
      message: 'This item is no longer available',
    }
  } else if (available <= 0) {
    reason = { code: SHOP_ERROR_CODES.OUT_OF_STOCK, message: 'Sold out' }
  } else if (quantity > ceiling) {
    // Which of the two bit decides what the customer is told — and, just as
    // importantly, whether a number may be named at all. Stock is only ever
    // quoted when it is under the limit, so the most this leaks is "fewer than
    // ten remain", never a live count (§18).
    reason =
      available <= MAX_QUANTITY_PER_ITEM
        ? {
            code: SHOP_ERROR_CODES.OUT_OF_STOCK,
            message:
              available === 1 ? 'Only 1 left — quantity reduced' : `Only ${available} left — quantity reduced`,
            requestedQuantity: quantity,
          }
        : {
            code: SHOP_ERROR_CODES.QUANTITY_EXCEEDED,
            message: `${MAX_QUANTITY_PER_ITEM} per item is the limit — quantity reduced`,
            requestedQuantity: quantity,
          }
    quantity = ceiling
  } else if (requested.priceSeen && requested.priceSeen !== price) {
    // Last, and never a blocker: the line is fine, the number simply moved
    // while the cart sat open.
    reason = {
      code: SHOP_ERROR_CODES.PRICE_CHANGED,
      message: 'The price changed since you added this',
      previousPrice: requested.priceSeen,
    }
  }

  const purchasable = sellable && available > 0

  return {
    id: requested.id ?? null,
    variantId: variant.id,
    productId: product.id,
    slug: product.slug,
    title: product.title,
    brand: product.brand,
    image: cover ? { url: cover.url, altText: cover.altText } : null,
    sku: variant.sku,
    options: optionLabel(variant),
    price,
    compareAtPrice: moneyOrNull(variant.compareAtPrice),
    discountPercent: discountPercent(variant.price, variant.compareAtPrice),
    quantity,
    // Computed here, never in the browser (§21). The client renders strings.
    lineTotal: purchasable ? variant.price.times(quantity).toFixed(2) : null,
    stock: stockBucket(inventory),
    maxQuantity: purchasableQuantity(inventory),
    purchasable,
    reason,
  }
}

/**
 * Subtotal only, and only over lines that could actually be bought. Shipping
 * and any discount are quoted by the checkout session — a total offered here
 * that checkout then contradicts is worse than no total at all (§21).
 */
export function serializeCart(lines: CartLine[]) {
  const usable = lines.filter((line) => line.purchasable)
  const subtotal = usable.reduce(
    (sum, line) => sum + Number(line.lineTotal ?? 0) * 100,
    0,
  )

  return {
    items: lines,
    /** Units, not lines — this is the number on the bag badge. */
    itemCount: usable.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: (subtotal / 100).toFixed(2),
    /** True when anything needs acknowledging before checkout is worth offering. */
    hasIssues: lines.some((line) => line.reason !== null),
  }
}

export type ShopCartPayload = ReturnType<typeof serializeCart>
