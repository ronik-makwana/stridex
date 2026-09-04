/**
 * Money arrives from the API as a fixed-point string and is only ever parsed
 * for display — never for arithmetic. Formatting is the one place a float is
 * harmless, because nothing downstream reads it back.
 *
 * There is no `add`, `sum` or `total` helper in this file, and there should
 * never be one. Every total the storefront shows was computed server-side
 * (§21); a client-side sum is how a customer sees a number the server never
 * agreed to.
 */

/**
 * One money formatter, used everywhere money is shown.
 *
 * Whole rupees when the amount is whole, paise when it is not: ₹8,999 for a
 * price, ₹1.98 for a cart that coupons have ground down to nearly nothing.
 *
 * It reads as one rule because it is one rule. There were three of these —
 * a rounding one for grids, an always-two-decimals one for refunds, and a
 * third in between — and the customer met all three in a single flow: a
 * checkout that said ₹1.98 leading to an order that said ₹2. Whichever of
 * those a customer believes, one of the pages lied to them, and a total they
 * cannot reconcile against their card statement is worth more than the
 * tidiness of dropping ".00" from a price grid.
 *
 * Prices in this catalogue are whole rupees, so the grids look exactly as they
 * did. Only the amounts that genuinely carry paise changed, which is the point.
 */
const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const withPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value)
  /**
   * Two decimals or none — never the one that a plain `maximumFractionDigits:
   * 2` would give you, which renders ₹2,048.20 as "₹2,048.2" and reads like a
   * number that lost a digit on the way to the page.
   */
  return Number.isInteger(parsed) ? wholeRupees.format(parsed) : withPaise.format(parsed)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Initials for the account menu when there is no avatar to show. */
export function initialsOf(user: { firstName: string | null; email: string }): string {
  const first = user.firstName?.trim()?.[0]
  return (first ?? user.email[0] ?? '?').toUpperCase()
}
