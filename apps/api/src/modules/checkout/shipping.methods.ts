import { Prisma } from '@shoe/db'

/**
 * The delivery services on offer. A static table, deliberately: these are three
 * facts about how the store ships, not catalogue data, and putting them in a
 * database buys an admin screen nobody asked for and a join on every quote.
 *
 * What is *not* static is the price. Only the code lives here; the rupees are
 * quoted server-side per session, because a rate the client could name is a
 * rate the client could argue with (§21). The storefront renders what
 * `quoteMethods` returns and never adds a surcharge of its own.
 *
 * Standard alone reads the settings row. It is the store's ordinary service —
 * the one the flat rate and the free-delivery threshold were written about — so
 * an admin who changes either changes standard delivery and nothing else. The
 * paid services carry their own rate and are never waived: "free delivery over
 * ₹1,999" is a promise about the slow van, and letting a threshold hand out
 * next-day delivery is how a shipping bill outgrows its margin.
 */

export type ShippingMethodCode = 'STANDARD' | 'EXPRESS' | 'PRIORITY'

type MethodDefinition = {
  code: ShippingMethodCode
  label: string
  /** The only thing most customers actually compare. */
  eta: string
  /** Null means "whatever the store has configured as its flat rate". */
  rate: number | null
  /** Whether the free-delivery threshold applies to this service. */
  waivable: boolean
}

export const SHIPPING_METHODS: readonly MethodDefinition[] = [
  { code: 'STANDARD', label: 'Standard', eta: '4–6 business days', rate: null, waivable: true },
  { code: 'EXPRESS', label: 'Express', eta: '2–3 business days', rate: 249, waivable: false },
  { code: 'PRIORITY', label: 'Priority', eta: 'Next business day', rate: 499, waivable: false },
]

/** What a session gets before the customer has expressed a preference. */
export const DEFAULT_SHIPPING_METHOD: ShippingMethodCode = 'STANDARD'

export const SHIPPING_METHOD_CODES = SHIPPING_METHODS.map((method) => method.code) as [
  ShippingMethodCode,
  ...ShippingMethodCode[],
]

type Settings = { shippingFlatRate: Prisma.Decimal; freeShippingThreshold: Prisma.Decimal | null }

/**
 * The rate for one method against one goods total.
 *
 * `goodsTotal` is the discounted total, not the raw subtotal — the same figure
 * the quote uses, so a coupon that drops an order under the threshold puts the
 * delivery charge back exactly as the summary says it does.
 */
export function rateFor(
  code: string,
  goodsTotal: Prisma.Decimal,
  settings: Settings | null,
): Prisma.Decimal {
  const method = SHIPPING_METHODS.find((candidate) => candidate.code === code)
  // An unknown code prices as standard rather than as free. It cannot arrive
  // from the API — the route validates against this same list — so this is the
  // answer for a row written before a method was retired, and undercharging a
  // courier is worse than quoting the ordinary rate.
  if (!method || method.rate === null) return standardRate(goodsTotal, settings, method?.waivable ?? true)
  return new Prisma.Decimal(method.rate)
}

function standardRate(
  goodsTotal: Prisma.Decimal,
  settings: Settings | null,
  waivable: boolean,
): Prisma.Decimal {
  if (!settings) return new Prisma.Decimal(0)
  const threshold = settings.freeShippingThreshold
  if (waivable && threshold && goodsTotal.greaterThanOrEqualTo(threshold)) {
    return new Prisma.Decimal(0)
  }
  return settings.shippingFlatRate
}

/**
 * The list as the checkout page draws it: every method with the price *this*
 * order would pay for it, so "Free" against standard and "₹249" against express
 * are both the server's arithmetic rather than the client's guess.
 */
export function quoteMethods(goodsTotal: Prisma.Decimal, settings: Settings | null) {
  return SHIPPING_METHODS.map((method) => ({
    code: method.code,
    label: method.label,
    eta: method.eta,
    amount: rateFor(method.code, goodsTotal, settings),
  }))
}

/** The label for a stored code, for orders placed under a method since retired. */
export function labelFor(code: string): string {
  return SHIPPING_METHODS.find((method) => method.code === code)?.label ?? code
}
