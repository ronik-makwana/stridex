import { Prisma } from '@shoe/db'

/**
 * What a refund is worth, to the paisa.
 *
 * Entirely a calculation — no reads, no writes, no Prisma client. That is
 * deliberate: this is the file where a wrong answer costs money, and it has to
 * be checkable by reading it rather than by running the whole checkout (§21).
 *
 * The money it works from is the **snapshot on `order_items`**, never today's
 * catalog. Three columns say what a line actually cost:
 *
 *   total_price               gross, before any code
 *   discount_amount           this line's own discount
 *   order_discount_allocated  its share of the cart-wide one
 *
 * The third exists precisely so this file does not have to re-derive a split
 * that was decided at checkout — by then the prices have moved and the codes
 * may be gone (§19). Subtracting both is what the customer paid for the line.
 */

const ZERO = new Prisma.Decimal(0)

/**
 * Down, not nearest. Every rounding decision here is made in the customer's
 * favour on the *last* unit rather than the first: a partial refund that
 * rounded up would, three partials later, refund more than was charged.
 */
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)

/** The columns this file needs. Anything with these shapes will do. */
export type RefundableLine = {
  id: string
  quantity: number
  totalPrice: Prisma.Decimal
  discountAmount: Prisma.Decimal
  orderDiscountAllocated: Prisma.Decimal
}

export type RefundableOrder = {
  totalAmount: Prisma.Decimal
  shippingAmount: Prisma.Decimal
  shippingDiscount: Prisma.Decimal
}

/** What the whole line cost after both discounts. Never below zero. */
export function lineNet(line: RefundableLine): Prisma.Decimal {
  const net = line.totalPrice.minus(line.discountAmount).minus(line.orderDiscountAllocated)
  return net.greaterThan(ZERO) ? money(net) : ZERO
}

/**
 * What the first `units` of a line are worth, cumulatively.
 *
 * Cumulative rather than per-unit on purpose. Three of five units back today
 * and two next month must add up to exactly the line — and `net/5` rounded and
 * multiplied cannot promise that. Asking "what are the first k worth" twice and
 * subtracting can: whatever the rounding did to the first slice is inside the
 * number the second one starts from, and the last unit collects the remainder.
 */
function cumulative(line: RefundableLine, units: number): Prisma.Decimal {
  if (units <= 0) return ZERO
  // The whole line is the line, exactly. Not `net × qty / qty`, which is the
  // same number by luck rather than by definition.
  if (units >= line.quantity) return lineNet(line)
  return money(lineNet(line).times(units).dividedBy(line.quantity))
}

/**
 * What refunding `units` more of this line is worth, given how many have
 * already gone back.
 *
 * Zero when the line is exhausted, rather than a throw: the caller has already
 * decided this is a legal request, and a line worth nothing back — fully
 * discounted, or already refunded — is a real outcome.
 */
export function lineRefundAmount(
  line: RefundableLine,
  alreadyRefundedUnits: number,
  units: number,
): Prisma.Decimal {
  const from = Math.min(Math.max(alreadyRefundedUnits, 0), line.quantity)
  const to = Math.min(from + Math.max(units, 0), line.quantity)
  const amount = cumulative(line, to).minus(cumulative(line, from))
  return amount.greaterThan(ZERO) ? amount : ZERO
}

/**
 * What was actually paid for delivery: the rate, less whatever a shipping code
 * took off it. Refunded on a cancellation — the parcel never went — and not on
 * a return, where the delivery was performed and consumed.
 */
export function shippingPaid(order: RefundableOrder): Prisma.Decimal {
  const paid = order.shippingAmount.minus(order.shippingDiscount)
  return paid.greaterThan(ZERO) ? money(paid) : ZERO
}

/**
 * A refund that has not failed. PENDING and PROCESSING count as spent, because
 * money on its way out is money that cannot be promised to a second refund —
 * the ceiling has to hold before the provider answers, not after (§7).
 */
export type CountedRefund = {
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'
  amount: Prisma.Decimal
  items: { orderItemId: string; quantity: number }[]
}

const COUNTS = new Set(['PENDING', 'PROCESSING', 'SUCCEEDED'])

/**
 * How much of this order has already gone back, and how many units of each
 * line went with it.
 *
 * One pass, both answers, because they are always wanted together and reading
 * them from two places is how they end up disagreeing.
 */
export function refundedSoFar(refunds: CountedRefund[]): {
  amount: Prisma.Decimal
  unitsByLine: Map<string, number>
} {
  let amount = ZERO
  const unitsByLine = new Map<string, number>()

  for (const refund of refunds) {
    if (!COUNTS.has(refund.status)) continue
    amount = amount.plus(refund.amount)
    for (const item of refund.items) {
      unitsByLine.set(item.orderItemId, (unitsByLine.get(item.orderItemId) ?? 0) + item.quantity)
    }
  }

  return { amount, unitsByLine }
}

/**
 * The most that may still be refunded on this order, ever.
 *
 * Counted against what was **charged**, not against what the lines are worth:
 * shipping was charged too, and a full return plus a shipping refund must
 * still not exceed the total. This is the last guard before the provider is
 * called, and the one that makes a double-clicked refund button harmless.
 */
export function refundCeiling(
  order: RefundableOrder,
  refunds: CountedRefund[],
): Prisma.Decimal {
  const remaining = order.totalAmount.minus(refundedSoFar(refunds).amount)
  return remaining.greaterThan(ZERO) ? money(remaining) : ZERO
}

/** How many units of a line may still be sent back. */
export function returnableUnits(line: RefundableLine, unitsByLine: Map<string, number>): number {
  return Math.max(line.quantity - (unitsByLine.get(line.id) ?? 0), 0)
}

export type RefundSelection = { orderItemId: string; quantity: number }

export type RefundQuote = {
  items: { orderItemId: string; quantity: number; amount: Prisma.Decimal }[]
  goodsTotal: Prisma.Decimal
  shipping: Prisma.Decimal
  total: Prisma.Decimal
}

/**
 * Price a set of lines coming back.
 *
 * `includeShipping` is the cancellation flag: nothing shipped, so the delivery
 * charge goes back with the goods. A return leaves it — the courier was paid
 * and the parcel arrived.
 *
 * Selections naming a line that is not on the order, or asking for more units
 * than remain, are the caller's job to reject; this prices what it is given and
 * clamps to what is left rather than inventing money.
 */
export function quoteRefund(
  order: RefundableOrder,
  lines: RefundableLine[],
  selections: RefundSelection[],
  options: { includeShipping?: boolean; alreadyRefunded?: CountedRefund[] } = {},
): RefundQuote {
  const { unitsByLine } = refundedSoFar(options.alreadyRefunded ?? [])
  const byId = new Map(lines.map((line) => [line.id, line]))

  const items: RefundQuote['items'] = []
  let goodsTotal = ZERO

  for (const selection of selections) {
    const line = byId.get(selection.orderItemId)
    if (!line) continue

    const already = unitsByLine.get(line.id) ?? 0
    const units = Math.min(selection.quantity, returnableUnits(line, unitsByLine))
    if (units <= 0) continue

    const amount = lineRefundAmount(line, already, units)
    items.push({ orderItemId: line.id, quantity: units, amount })
    goodsTotal = goodsTotal.plus(amount)
  }

  const shipping = options.includeShipping ? shippingPaid(order) : ZERO

  return { items, goodsTotal, shipping, total: goodsTotal.plus(shipping) }
}

/**
 * Whether every unit on the order has been refunded — the fulfilment question,
 * and what moves `orders.status` to REFUNDED.
 *
 * Deliberately counted in units rather than money. A line fully discounted to
 * zero is worth nothing back and still came home, and an order whose goods have
 * all been returned is refunded whatever the arithmetic says about shipping.
 */
export function allGoodsRefunded(
  lines: RefundableLine[],
  refunds: CountedRefund[],
): boolean {
  const { unitsByLine } = refundedSoFar(refunds)
  return lines.every((line) => returnableUnits(line, unitsByLine) === 0)
}

// ─── the windows ─────────────────────────────────────────────────────────────

/**
 * When the return window shuts: `returnWindowDays` after the parcel arrived.
 *
 * Null when nothing has been delivered — there is no window to be inside yet,
 * which is a different answer from "the window has closed" and the UI says so
 * differently.
 *
 * Recomputed from `delivered_at` on every read rather than stored, so a store
 * that extends returns to 14 days extends them for orders already out there.
 */
export function returnWindowEndsAt(deliveredAt: Date | null, days: number): Date | null {
  if (!deliveredAt) return null
  return new Date(deliveredAt.getTime() + days * 24 * 60 * 60 * 1000)
}

export function isWithinReturnWindow(
  deliveredAt: Date | null,
  days: number,
  now: Date = new Date(),
): boolean {
  const ends = returnWindowEndsAt(deliveredAt, days)
  return ends !== null && now.getTime() <= ends.getTime()
}
