import { z } from 'zod'
import { MAX_QUANTITY_PER_ITEM } from '../../serializers/shop/stock.serializer.js'

/**
 * The guest cart lives in localStorage and arrives here to be priced. That is
 * the whole shape of Phase 14: the client remembers *what* was chosen, and the
 * server is the only thing that decides what it costs and whether it can still
 * be bought (§5, §21).
 */

const variantIdSchema = z.uuid('Not a valid id')

/**
 * Deliberately wider than `MAX_QUANTITY_PER_ITEM` on the way in. A cart written
 * three weeks ago under a different limit is stale data, not an attack, and
 * rejecting the whole request over one line would leave the customer with a bag
 * they cannot even look at. The service clamps and says which line it clamped.
 */
const storedQuantitySchema = z.coerce.number().int().min(1).max(999)

/** What an explicit add or update may ask for. Above the limit is a mistake the UI should not have allowed. */
const requestedQuantitySchema = z.coerce
  .number()
  .int('Whole units only')
  .min(1, 'At least one')
  .max(MAX_QUANTITY_PER_ITEM, `${MAX_QUANTITY_PER_ITEM} per item is the limit`)

/**
 * `priceSeen` is display-only and never trusted: it exists so the cart can say
 * "was ₹7,499" when a price moved under a cart that was sitting open. It is
 * echoed back as `previousPrice` and is never an input to any total — every
 * figure the customer sees is computed here from the live price (§5).
 */
export const storedCartLineSchema = z.object({
  variantId: variantIdSchema,
  quantity: storedQuantitySchema,
  priceSeen: z
    .string()
    .trim()
    .max(20)
    .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Not a price')
    .nullish(),
})

/**
 * Capped at 50 lines. A real bag is under ten; the ceiling is here because this
 * endpoint is public and takes an array of ids, which is a catalog dump with
 * extra steps if it is left unbounded.
 */
export const hydrateCartSchema = z.object({
  items: z.array(storedCartLineSchema).max(50, 'That is more than a cart holds'),
})

/** Merge is hydrate that writes. Same shape, so the client sends the same array. */
export const mergeCartSchema = hydrateCartSchema

export const addCartItemSchema = z.object({
  variantId: variantIdSchema,
  quantity: requestedQuantitySchema.default(1),
})

export const updateCartItemSchema = z.object({
  // No zero-means-delete: DELETE is the way to remove a line, and a stepper
  // that silently deletes at zero is how people lose items they meant to keep.
  quantity: requestedQuantitySchema,
})

export type StoredCartLine = z.infer<typeof storedCartLineSchema>
export type HydrateCartInput = z.infer<typeof hydrateCartSchema>
export type MergeCartInput = z.infer<typeof mergeCartSchema>
export type AddCartItemInput = z.infer<typeof addCartItemSchema>
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>
