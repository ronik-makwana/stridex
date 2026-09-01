import { del, get, patch, post } from '@/lib/api-client'
import type { Cart } from '@/types/api'
import type { LocalCartLine } from './local-cart'

/**
 * Half of this is public and half is not, and the split is the phase: a guest
 * prices their localStorage cart through `hydrate`, a signed-in customer's cart
 * is rows the server owns. Both answer with the same `Cart` payload, which is
 * what lets `useCart()` hide the difference from every component.
 */
export const cartApi = {
  /** Public. Ids and quantities in, today's prices and reasons out. */
  hydrate: (items: LocalCartLine[]) => post<Cart>('/cart/hydrate', { items }),

  get: () => get<Cart>('/cart'),

  /** Every write answers with the whole cart — the badge and subtotal move too. */
  addItem: (variantId: string, quantity = 1) =>
    post<Cart>('/cart/items', { variantId, quantity }),

  updateItem: (id: string, quantity: number) => patch<Cart>(`/cart/items/${id}`, { quantity }),

  removeItem: (id: string) => del<Cart>(`/cart/items/${id}`),

  clear: () => del<Cart>('/cart'),

  /** On login and on register, with whatever the browser was holding. */
  merge: (items: LocalCartLine[]) => post<Cart>('/cart/merge', { items }),
}
