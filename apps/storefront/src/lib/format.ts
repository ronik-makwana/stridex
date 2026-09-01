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
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  // Whole rupees. Indian retail prices are 8,999, not 8,999.00, and the extra
  // zeros make a grid noisier without telling anyone anything.
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? currency.format(parsed) : String(value)
}

/** For the rare place a paisa matters — an order summary line, a refund. */
const preciseCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
})

export function formatMoneyExact(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? preciseCurrency.format(parsed) : String(value)
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
