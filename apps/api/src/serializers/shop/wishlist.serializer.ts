import type { Prisma } from '@shoe/db'
import { discountPercent, money, moneyOrNull } from './money.js'
import { purchasableQuantity, stockBucket } from './stock.serializer.js'

/**
 * A saved product, plus the sizes it comes in.
 *
 * The variants are the reason this is not simply the grid card. A wishlist is
 * per product and a cart is per variant, so moving something to the bag needs a
 * size chosen — and the spec puts that picker on the card itself rather than
 * sending someone back to the product page for one tap. Shipping the sizes with
 * the list is what makes that one request instead of one per card.
 */

export type WishlistProductRecord = Prisma.ProductGetPayload<{
  include: {
    brand: { select: { id: true; name: true; slug: true } }
    media: { orderBy: { sortOrder: 'asc' }; take: 1 }
    variants: {
      include: {
        inventory: true
        optionAssignments: { include: { optionValue: { include: { variantOption: true } } } }
      }
    }
  }
}>

export function serializeWishlistItem(product: WishlistProductRecord, savedAt: Date) {
  const variants = product.variants.filter((variant) => variant.status === 'ACTIVE')
  const cover = product.media[0]

  // The price shown is the cheapest sellable one — the same rule the grid card
  // follows, so a product does not appear to change price by being saved.
  let cheapest = variants[0]
  for (const variant of variants) if (variant.price.lessThan(cheapest!.price)) cheapest = variant

  const buckets = variants.map((variant) => stockBucket(variant.inventory))

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    brand: product.brand,
    image: cover ? { url: cover.url, altText: cover.altText } : null,
    price: cheapest ? money(cheapest.price) : null,
    compareAtPrice: cheapest ? moneyOrNull(cheapest.compareAtPrice) : null,
    discountPercent: cheapest ? discountPercent(cheapest.price, cheapest.compareAtPrice) : null,
    /** SOLD_OUT only when every size is. */
    stock: buckets.includes('IN_STOCK')
      ? ('IN_STOCK' as const)
      : buckets.includes('LOW_STOCK')
        ? ('LOW_STOCK' as const)
        : ('SOLD_OUT' as const),
    /**
     * Every sellable size, each already knowing whether it can be picked — the
     * inline picker disables rather than hides, so a shopper can see that their
     * size is the one that sold out.
     */
    variants: variants.map((variant) => ({
      id: variant.id,
      label: [...variant.optionAssignments]
        .sort((a, b) =>
          (a.optionValue.variantOption?.name ?? '').localeCompare(
            b.optionValue.variantOption?.name ?? '',
          ),
        )
        .map((assignment) => assignment.optionValue.value)
        .join(' / '),
      price: money(variant.price),
      stock: stockBucket(variant.inventory),
      maxQuantity: purchasableQuantity(variant.inventory),
    })),
    savedAt,
  }
}

export type ShopWishlistItemPayload = ReturnType<typeof serializeWishlistItem>
