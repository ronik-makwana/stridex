import { z } from 'zod'

/**
 * A wishlist is per product, not per variant — saving a shoe rather than a
 * shoe in a size. Moving one to the bag therefore needs a size chosen, which
 * is why the payload carries every sellable variant per saved product.
 */
const productIdSchema = z.uuid('Not a valid id')

/**
 * 100 rather than the cart's 50: saving is cheap and people hoard. Still
 * bounded — this is a public endpoint taking an array of ids.
 */
export const hydrateWishlistSchema = z.object({
  productIds: z.array(productIdSchema).max(100, 'That is more than a wishlist holds'),
})

export const mergeWishlistSchema = hydrateWishlistSchema

export const addWishlistItemSchema = z.object({ productId: productIdSchema })

/** `DELETE /wishlist/items/:productId` — keyed by product, like the table is. */
export const wishlistItemParamSchema = z.object({ productId: productIdSchema })

export type HydrateWishlistInput = z.infer<typeof hydrateWishlistSchema>
export type MergeWishlistInput = z.infer<typeof mergeWishlistSchema>
export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>
export type WishlistItemParam = z.infer<typeof wishlistItemParamSchema>
