/**
 * Money arrives from the API as a fixed-point string and is only ever parsed
 * for display — never for arithmetic. Formatting is the one place a float is
 * harmless, because nothing downstream reads it back.
 */
/**
 * The same rule the storefront uses, deliberately — two decimals or none.
 *
 * An order is one order however you are looking at it, and a refund quoted to
 * a customer as ₹1.98 has to be the ₹1.98 the person approving it sees. The
 * two apps having their own opinion about trailing zeros is how a support
 * conversation ends up comparing ₹2,048.20 against ₹2,048 and wondering which
 * one moved.
 *
 * Never one decimal: a plain `maximumFractionDigits: 2` renders ₹2,048.20 as
 * "₹2,048.2", which reads like a number that lost a digit on the way here.
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
  return Number.isInteger(parsed) ? wholeRupees.format(parsed) : withPaise.format(parsed)
}

const integers = new Intl.NumberFormat('en-IN')

export const formatCount = (value: number): string => integers.format(value)

/** '2 days ago', 'just now'. Absolute dates go in tooltips, not in table cells. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(-Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Date and time together, for the rows where the order of two events on the
 * same day is the whole point — a payment ledger, a status history.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
