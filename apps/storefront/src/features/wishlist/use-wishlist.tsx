import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import type { WishlistItem } from '@/types/api'
import { wishlistApi } from './api'
import {
  adoptedByServer,
  getServerSnapshot,
  getSnapshot,
  parseIds,
  readIds,
  removeId,
  saveId,
  subscribe,
} from './local-wishlist'

/**
 * The cart's twin, and deliberately the same shape: guest ids in localStorage,
 * stored rows once signed in, one payload either way. See `use-cart.tsx` for
 * why the split lives in the hook rather than in the components.
 *
 * The heart is a toggle, so `isSaved` matters more here than the list does —
 * every product card asks it, and it must answer without a request.
 */

const EMPTY: WishlistItem[] = []

export const wishlistKeys = {
  all: ['wishlist'] as const,
  server: () => [...wishlistKeys.all, 'me'] as const,
  guest: (raw: string) => [...wishlistKeys.all, 'guest', raw] as const,
}

export function useWishlist() {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const raw = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const localIds = React.useMemo(() => parseIds(raw), [raw])

  const query = useQuery({
    queryKey: isAuthenticated ? wishlistKeys.server() : wishlistKeys.guest(raw),
    queryFn: () => (isAuthenticated ? wishlistApi.get() : wishlistApi.hydrate(localIds)),
    enabled: isAuthenticated || localIds.length > 0,
    staleTime: 60_000,
  })

  const items = query.data ?? EMPTY
  const adopt = (next: WishlistItem[]) => queryClient.setQueryData(wishlistKeys.server(), next)

  /**
   * Answered from the id list, not from the hydrated tiles. A heart that waits
   * for a round trip to know whether it is filled flickers on every card in a
   * grid — and for a signed-in customer the tiles are the id list anyway.
   */
  const savedIds = React.useMemo(
    () => new Set(isAuthenticated ? items.map((item) => item.id) : localIds),
    [isAuthenticated, items, localIds],
  )

  const save = useMutation({
    mutationFn: async (productId: string) => {
      if (isAuthenticated) return adopt(await wishlistApi.save(productId))
      saveId(productId)
    },
  })

  const remove = useMutation({
    mutationFn: async (productId: string) => {
      if (isAuthenticated) return adopt(await wishlistApi.remove(productId))
      removeId(productId)
    },
  })

  const toggle = React.useCallback(
    async (productId: string) => {
      if (savedIds.has(productId)) return remove.mutateAsync(productId)
      return save.mutateAsync(productId)
    },
    [savedIds, remove, save],
  )

  return {
    items,
    count: savedIds.size,
    isSaved: (productId: string) => savedIds.has(productId),
    isLoading: query.isPending && query.fetchStatus !== 'idle',
    save: save.mutateAsync,
    remove: remove.mutateAsync,
    toggle,
    isMutating: save.isPending || remove.isPending,
  }
}

/** The wishlist half of `afterAuth()`. Local storage clears only after the server answers. */
export async function mergeGuestWishlist(): Promise<WishlistItem[] | null> {
  const ids = readIds()
  if (ids.length === 0) return null
  const merged = await wishlistApi.merge(ids)
  adoptedByServer()
  return merged
}
