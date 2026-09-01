import type { Prisma } from '@shoe/db'

/**
 * Money leaves as a fixed-point string, never a JSON number. `Decimal(12,2)`
 * survives the trip intact that way; a float does not — 8999.95 has no exact
 * IEEE-754 representation, and a price that drifts by a paisa between the grid
 * and the order is a bug nobody can reproduce.
 *
 * The storefront never does arithmetic on these. Every total it renders was
 * computed server-side (§21); these strings are for display only.
 */
export const money = (value: Prisma.Decimal): string => value.toFixed(2)

export const moneyOrNull = (value: Prisma.Decimal | null): string | null =>
  value === null ? null : value.toFixed(2)

/**
 * A markdown is only real when compare-at is strictly above the price. Stored
 * the other way round — or equal — it is stale admin data, and rendering
 * "-0% off" beside a struck-through equal price is worse than rendering
 * nothing.
 *
 * This is catalog markdown, not a discount line: it is already inside
 * `price`, and it never appears in an order summary as a deduction (§15.3).
 */
export function discountPercent(
  price: Prisma.Decimal,
  compareAtPrice: Prisma.Decimal | null,
): number | null {
  if (!compareAtPrice || compareAtPrice.lessThanOrEqualTo(price)) return null
  const percent = compareAtPrice.minus(price).dividedBy(compareAtPrice).times(100)
  // Rounded down: claiming 50% off a 49.6% markdown is the kind of small lie
  // that becomes a consumer-protection complaint.
  const floored = Math.floor(percent.toNumber())
  return floored > 0 ? floored : null
}
