import type { Inventory } from '@shoe/db'

/**
 * The single most important rule in `serializers/shop/`: a customer is told
 * whether they can buy, never how many exist. An exact count is a scraping
 * target and a public read of sales velocity — a competitor polling one SKU
 * hourly learns the run rate without buying anything.
 *
 * Every storefront surface that mentions stock goes through this file. If a
 * second place ever computes a bucket, the two will disagree the day the
 * threshold changes.
 */
export const STOCK_BUCKETS = ['IN_STOCK', 'LOW_STOCK', 'SOLD_OUT'] as const
export type StockBucket = (typeof STOCK_BUCKETS)[number]

/**
 * Hard ceiling on one line of an order, independent of stock. Stops a single
 * cart from clearing a SKU and gives `purchasableQuantity` a bound that does
 * not move with inventory.
 */
export const MAX_QUANTITY_PER_ITEM = 10

/** What is left to sell. Reserved units belong to open checkouts (§1). */
export function availableQuantity(inventory: Pick<Inventory, 'quantity' | 'reservedQuantity'> | null | undefined): number {
  if (!inventory) return 0
  // Clamped: an over-reservation bug must read as sold out, never as negative
  // stock that a `> 0` check elsewhere reads as "plenty".
  return Math.max(0, inventory.quantity - inventory.reservedQuantity)
}

/**
 * The one bucket function. A missing inventory row is SOLD_OUT, not an error —
 * a variant created without one is a data problem, and the customer-facing
 * answer to "can I buy this" is still no.
 */
export function stockBucket(
  inventory: Pick<Inventory, 'quantity' | 'reservedQuantity' | 'lowStockThreshold'> | null | undefined,
): StockBucket {
  const available = availableQuantity(inventory)
  if (available <= 0) return 'SOLD_OUT'
  // `lowStockThreshold` is the operator's own number from the admin inventory
  // screen, so "Only a few left" means what that operator decided it means.
  if (available <= (inventory?.lowStockThreshold ?? 0)) return 'LOW_STOCK'
  return 'IN_STOCK'
}

/**
 * How many the quantity stepper may offer.
 *
 * This is the one deliberate exception to "never send a number", and it is
 * bounded on purpose: the answer is capped at MAX_QUANTITY_PER_ITEM, so the
 * most anyone learns from it is "fewer than ten remain" — not a count, not a
 * trend. Without it the stepper either guesses and the customer meets a
 * server-side rejection at checkout, or it fetches per keystroke.
 *
 * It is a display cap, not a guarantee. Phase 15 revalidates every line against
 * live inventory inside the reservation transaction regardless of what this
 * returned (§17).
 */
export function purchasableQuantity(
  inventory: Pick<Inventory, 'quantity' | 'reservedQuantity'> | null | undefined,
): number {
  return Math.min(availableQuantity(inventory), MAX_QUANTITY_PER_ITEM)
}

/** True when a variant can be added to a cart at all. */
export const isPurchasable = (bucket: StockBucket): boolean => bucket !== 'SOLD_OUT'
