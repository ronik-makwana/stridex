import { z } from 'zod'
import { SHIPPING_METHOD_CODES } from '../../modules/checkout/shipping.methods.js'

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

/**
 * A code from the static table, and nothing else. No rate, no label: the client
 * naming its own delivery charge is the one thing this endpoint exists to
 * prevent (§21).
 */
export const setShippingMethodSchema = z.object({
  method: z.enum(SHIPPING_METHOD_CODES, { message: 'Choose a delivery speed' }),
})

export type SetShippingMethodInput = z.infer<typeof setShippingMethodSchema>

/**
 * A code, and nothing else. What it is worth is the server's answer, not the
 * client's claim (§21).
 */
export const applyCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a discount code')
    .max(40, "That's longer than any code")
    .transform((value) => value.toUpperCase()),
})

export type ApplyCouponInput = z.infer<typeof applyCouponSchema>
