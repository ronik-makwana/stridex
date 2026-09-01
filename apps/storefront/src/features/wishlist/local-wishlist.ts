/**
 * The guest wishlist: product ids, newest first, in localStorage. The cart's
 * quieter twin — no quantities, no prices, nothing to clamp — so it stores a
 * plain array of ids and is hydrated into tiles by the API.
 *
 * Same external-store shape as `local-cart.ts` so both behave identically
 * across tabs. See that file for why the snapshot is a raw string.
 */

const KEY = 'stridex.wishlist.v1'

type Listener = () => void
const listeners = new Set<Listener>()

let snapshot = '[]'

function safeRead(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '[]'
  } catch {
    return '[]'
  }
}

snapshot = typeof window === 'undefined' ? '[]' : safeRead()

function emit() {
  for (const listener of listeners) listener()
}

function commit(ids: string[]) {
  snapshot = JSON.stringify(ids)
  try {
    window.localStorage.setItem(KEY, snapshot)
  } catch {
    /* see local-cart.ts */
  }
  emit()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getSnapshot = (): string => snapshot
export const getServerSnapshot = (): string => '[]'

export function parseIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export const readIds = (): string[] => parseIds(snapshot)

/** Newest first, and saving twice is a no-op rather than a duplicate tile. */
export function saveId(productId: string) {
  const ids = readIds().filter((id) => id !== productId)
  commit([productId, ...ids])
}

export function removeId(productId: string) {
  commit(readIds().filter((id) => id !== productId))
}

export function clearIds() {
  commit([])
}

/** Only after the server has acknowledged the merge. */
export const adoptedByServer = clearIds

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    snapshot = safeRead()
    emit()
  })
}
