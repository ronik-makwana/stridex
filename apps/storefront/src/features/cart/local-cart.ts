/**
 * The guest cart. Lives in localStorage, holds variant ids and quantities, and
 * is priced by `POST /cart/hydrate` on every read — so a cart left open for three
 * weeks shows today's price and today's availability rather than a stale
 * snapshot somebody could argue with (§5, §21).
 *
 * `priceSeen` is the one number stored, and it is never money: it is what the
 * customer was last shown, echoed back by the server as `previousPrice` so the
 * cart can say "was ₹7,499". Nothing computes with it, here or on the server.
 *
 * An external store rather than React state, because two tabs are one cart: the
 * `storage` event makes the other tab's badge move without a refresh.
 */

const KEY = 'stridex.cart.v1'

export type LocalCartLine = {
  variantId: string
  quantity: number
  priceSeen?: string | null
}

type Listener = () => void
const listeners = new Set<Listener>()

/**
 * The snapshot is the raw string, not a parsed array. `useSyncExternalStore`
 * compares snapshots by identity, and parsing here would hand it a new array
 * every render and spin forever.
 */
let snapshot = '[]'

function safeRead(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '[]'
  } catch {
    // Private mode, or storage disabled entirely. A cart that cannot persist is
    // still a cart for the length of this page.
    return '[]'
  }
}

snapshot = typeof window === 'undefined' ? '[]' : safeRead()

function emit() {
  for (const listener of listeners) listener()
}

function commit(lines: LocalCartLine[]) {
  snapshot = JSON.stringify(lines)
  try {
    window.localStorage.setItem(KEY, snapshot)
  } catch {
    // Keep the in-memory copy: losing the write is survivable, losing the cart
    // the customer is looking at is not.
  }
  emit()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getSnapshot = (): string => snapshot
/** Server render and the first client render must agree. There is no cart on the server. */
export const getServerSnapshot = (): string => '[]'

export function parseLines(raw: string): LocalCartLine[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Anything that is not a well-formed line is dropped rather than sent: this
    // is user-writable storage, and the API would reject the whole array over
    // one bad entry.
    return parsed.filter(
      (line): line is LocalCartLine =>
        Boolean(line) &&
        typeof (line as LocalCartLine).variantId === 'string' &&
        Number.isInteger((line as LocalCartLine).quantity) &&
        (line as LocalCartLine).quantity > 0,
    )
  } catch {
    return []
  }
}

export const readLines = (): LocalCartLine[] => parseLines(snapshot)

/** Adding the same variant twice adds up, exactly as the server's cart does. */
export function addLine(variantId: string, quantity: number, priceSeen?: string | null) {
  const lines = readLines()
  const existing = lines.find((line) => line.variantId === variantId)
  if (existing) {
    existing.quantity += quantity
    existing.priceSeen = priceSeen ?? existing.priceSeen
  } else {
    lines.push({ variantId, quantity, priceSeen: priceSeen ?? null })
  }
  commit(lines)
}

export function setQuantity(variantId: string, quantity: number) {
  const lines = readLines()
  const existing = lines.find((line) => line.variantId === variantId)
  if (!existing) return
  existing.quantity = quantity
  commit(lines)
}

export function removeLine(variantId: string) {
  commit(readLines().filter((line) => line.variantId !== variantId))
}

export function clearLines() {
  commit([])
}

/**
 * Called after a merge has been acknowledged by the server, and only then —
 * clearing first and failing the request afterwards is how a cart disappears
 * during a sign-in.
 */
export const adoptedByServer = clearLines

if (typeof window !== 'undefined') {
  // The other tab. `storage` fires everywhere except the tab that wrote it,
  // which is exactly the gap `commit`'s own emit fills.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    snapshot = safeRead()
    emit()
  })
}
