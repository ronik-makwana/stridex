import type { OrderStatus } from '@shoe/db'
import { unprocessable } from '../../lib/errors.js'

/**
 * The fulfilment state machine, as an allow-list.
 *
 * Every status write goes through here and an illegal move **throws** — it does
 * not silently no-op (§11). A no-op looks like success to whoever clicked it,
 * and the order stays where it was while everybody believes otherwise.
 *
 * Backwards moves are allowed, one step, and are not the same thing as illegal.
 * A parcel marked shipped by mistake has to be correctable, and an admin who
 * cannot fix a mis-click will fix it in the database instead — where nothing
 * writes history. The UI warns; this permits.
 */
const FORWARD: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  // Terminal. An order that was cancelled or refunded is history, and reviving
  // one hides what actually happened behind a status that no longer matches the
  // money or the stock.
  CANCELLED: [],
  REFUNDED: [],
}

/** Corrections, allowed and flagged. One step back, never from a terminal state. */
const BACKWARD: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [],
  PROCESSING: ['PENDING'],
  SHIPPED: ['PROCESSING'],
  DELIVERED: ['SHIPPED'],
  CANCELLED: [],
  REFUNDED: [],
}

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  FORWARD[from].includes(to) || BACKWARD[from].includes(to)

export const isBackwards = (from: OrderStatus, to: OrderStatus): boolean =>
  BACKWARD[from].includes(to)

/** What the modal offers, so the client never has to know the machine. */
export function allowedTransitions(from: OrderStatus) {
  return [
    ...FORWARD[from].map((to) => ({ to, backwards: false })),
    ...BACKWARD[from].map((to) => ({ to, backwards: true })),
  ]
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw unprocessable(`This order is already ${to.toLowerCase()}`)
  }
  if (!canTransition(from, to)) {
    const allowed = allowedTransitions(from).map((option) => option.to.toLowerCase())
    throw unprocessable(
      `An order cannot go from ${from.toLowerCase()} to ${to.toLowerCase()}`,
      allowed.length > 0
        ? `From here it can go to: ${allowed.join(', ')}.`
        : `${from.toLowerCase()} is where this order ends.`,
    )
  }
}
