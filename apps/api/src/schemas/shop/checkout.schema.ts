import { z } from 'zod'

/**
 * `POST /checkout` takes almost nothing. The lines come from the customer's
 * cart and the prices come from the catalog — a body that could name either
 * would be a body that could name a price (§5).
 *
 * The two addresses are optional here and settable afterwards, because the
 * common path is "checkout, then choose where it goes", and a session that
 * cannot be created without an address makes the address form block the stock
 * hold rather than the other way round.
 */
export const createCheckoutSchema = z.object({
  shippingAddressId: z.uuid('Not a valid id').optional(),
  billingAddressId: z.uuid('Not a valid id').optional(),
})

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>

/**
 * Shipping is required and billing is not: the fallback is "same as delivery",
 * which is both the common case and the one the customer has already answered.
 */
export const setCheckoutAddressSchema = z.object({
  shippingAddressId: z.uuid('Choose a delivery address'),
  billingAddressId: z.uuid('Not a valid id').optional(),
})

export type SetCheckoutAddressInput = z.infer<typeof setCheckoutAddressSchema>
