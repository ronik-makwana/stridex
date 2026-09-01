import type { Cart } from '@/types/api'

/**
 * The one way into checkout, called from the cart drawer and the cart page, so
 * the two cannot start it differently.
 *
 * A plain path rather than a session: `/checkout` creates the session on
 * arrival and puts its id in the URL, which is what makes a refresh restore the
 * same one instead of holding the stock twice.
 */
export const CHECKOUT_PATH = '/checkout'

/** Nothing sellable means nothing to check out — a dead end with a redirect. */
export const canCheckout = (cart: Cart): boolean => cart.items.some((line) => line.purchasable)
