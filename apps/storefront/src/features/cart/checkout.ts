import { toast } from 'sonner'
import { formatMoney } from '@/lib/format'
import type { Cart } from '@/types/api'

/**
 * The one way into checkout, called from the drawer and from the cart page, so
 * the two cannot start it differently. Phase 15 replaces the body with a
 * navigation to `/checkout` — which is also where the auth wall goes, so an
 * unauthenticated customer lands on `/login?redirect=/checkout` rather than
 * being blocked here.
 */
export function startCheckout(cart: Cart) {
  toast('Checkout arrives in Phase 15', {
    description: `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'} · ${formatMoney(cart.subtotal)}`,
  })
}

/** Nothing sellable means nothing to check out — a dead end with a redirect. */
export const canCheckout = (cart: Cart): boolean => cart.items.some((line) => line.purchasable)
