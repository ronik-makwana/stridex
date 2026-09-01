import { del, get, post } from '@/lib/api-client'
import type { WishlistItem } from '@/types/api'

export const wishlistApi = {
  /** Public. Saved ids in, tiles out; anything gone from the catalog is absent. */
  hydrate: (productIds: string[]) => post<WishlistItem[]>('/wishlist/hydrate', { productIds }),

  get: () => get<WishlistItem[]>('/wishlist'),

  /** Keyed by product, like the table: the heart on a card has no row id to hand. */
  save: (productId: string) => post<WishlistItem[]>('/wishlist/items', { productId }),

  remove: (productId: string) => del<WishlistItem[]>(`/wishlist/items/${productId}`),

  merge: (productIds: string[]) => post<WishlistItem[]>('/wishlist/merge', { productIds }),
}
