import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import type { Cart, CartLine } from '@/types/api'
import { cartApi } from './api'
import {
  addLine,
  adoptedByServer,
  clearLines,
  getServerSnapshot,
  getSnapshot,
  parseLines,
  readLines,
  removeLine,
  setQuantity,
  subscribe,
} from './local-cart'

/**
 * The one hook every component uses for the cart, and the reason none of them
 * contains `if (user)`. A guest's cart is localStorage priced by `hydrate`; a
 * customer's is rows on the server. Both arrive here as the same `Cart`, so a
 * cart line, the badge and the drawer are written once.
 *
 * The two differ in exactly one respect the callers can see: a guest line is
 * addressed by `variantId` and a stored one by `id`. `update` and `remove` take
 * the line itself rather than an id, so that stays in here.
 */

const EMPTY: Cart = { items: [], itemCount: 0, subtotal: '0.00', hasIssues: false }

export const cartKeys = {
  all: ['cart'] as const,
  server: () => [...cartKeys.all, 'me'] as const,
  /** Keyed on the stored string: editing the local cart *is* a new query. */
  guest: (raw: string) => [...cartKeys.all, 'guest', raw] as const,
}

/** Reads the guest cart as an external store, so a second tab moves this one. */
function useLocalLines() {
  const raw = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { raw, lines: React.useMemo(() => parseLines(raw), [raw]) }
}

export function useCart() {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const { raw, lines } = useLocalLines()

  const query = useQuery({
    queryKey: isAuthenticated ? cartKeys.server() : cartKeys.guest(raw),
    queryFn: () => (isAuthenticated ? cartApi.get() : cartApi.hydrate(lines)),
    // An empty guest cart has nothing to price, and a request per page load that
    // can only answer `[]` is a request worth not making.
    enabled: isAuthenticated || lines.length > 0,
    // Prices and stock move under an open tab; this is the window in which the
    // cart is allowed to be wrong before it re-reads.
    staleTime: 60_000,
  })

  const cart = query.data ?? EMPTY

  /** Writes the server's answer straight into the cache: one request per action. */
  const adopt = (next: Cart) => queryClient.setQueryData(cartKeys.server(), next)

  const add = useMutation({
    mutationFn: async (input: { variantId: string; quantity?: number; priceSeen?: string | null }) => {
      const quantity = input.quantity ?? 1
      if (isAuthenticated) return adopt(await cartApi.addItem(input.variantId, quantity))
      // The local write is what re-keys the query, so the new line is priced by
      // the server on the next render rather than guessed at here.
      addLine(input.variantId, quantity, input.priceSeen)
    },
  })

  const update = useMutation({
    mutationFn: async ({ line, quantity }: { line: CartLine; quantity: number }) => {
      if (isAuthenticated && line.id) return adopt(await cartApi.updateItem(line.id, quantity))
      setQuantity(line.variantId, quantity)
    },
  })

  const remove = useMutation({
    mutationFn: async (line: CartLine) => {
      if (isAuthenticated && line.id) return adopt(await cartApi.removeItem(line.id))
      removeLine(line.variantId)
    },
  })

  const clear = useMutation({
    mutationFn: async () => {
      if (isAuthenticated) return adopt(await cartApi.clear())
      clearLines()
    },
  })

  return {
    cart,
    items: cart.items,
    /** Straight from the server, never summed in the browser (§21). */
    itemCount: cart.itemCount,
    subtotal: cart.subtotal,
    hasIssues: cart.hasIssues,
    isLoading: query.isPending && query.fetchStatus !== 'idle',
    isFetching: query.isFetching,
    error: query.error,
    add: add.mutateAsync,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
    clear: clear.mutateAsync,
    isMutating: add.isPending || update.isPending || remove.isPending || clear.isPending,
  }
}

/**
 * The merge half of `afterAuth()`. Sends the guest cart, and clears local
 * storage **only** once the server has answered — the other order loses a cart
 * whenever the request fails.
 */
export async function mergeGuestCart(): Promise<Cart | null> {
  const lines = readLines()
  if (lines.length === 0) return null
  const merged = await cartApi.merge(lines)
  adoptedByServer()
  return merged
}

// ─── the drawer ──────────────────────────────────────────────────────────────

/**
 * Add to cart opens the drawer from wherever it was pressed — a product page, a
 * wishlist tile, a card — so the open state is a module-level store rather than
 * context threaded through every one of them. `/cart` stays a real route: the
 * drawer is a convenience, not the only way to see a cart.
 */
let drawerOpen = false
const drawerListeners = new Set<() => void>()

function setDrawer(open: boolean) {
  drawerOpen = open
  for (const listener of drawerListeners) listener()
}

export const openCartDrawer = () => setDrawer(true)
export const closeCartDrawer = () => setDrawer(false)

export function useCartDrawer() {
  const open = React.useSyncExternalStore(
    (listener) => {
      drawerListeners.add(listener)
      return () => drawerListeners.delete(listener)
    },
    () => drawerOpen,
    () => false,
  )
  return { open, setOpen: setDrawer, openDrawer: openCartDrawer, closeDrawer: closeCartDrawer }
}
