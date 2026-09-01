import { Prisma } from '@shoe/db'
import { buildWhere } from '../collections/rules.engine.js'
import type { RuleInput } from '../../schemas/admin/collection.schema.js'

/**
 * What a discount code is worth against one checkout session.
 *
 * Everything here is a **calculation**, not a write: it answers "does this code
 * apply, and for how much", and the caller decides what to do with the answer.
 * That is what lets the same function serve both the apply endpoint — where a
 * failure is a message the customer reads — and the re-quote, where the answer
 * is simply the number the total is built from (§21).
 *
 * Only product discounts exist so far. Order and shipping discounts land in the
 * same function, against the same lines, when they are built.
 */

export const couponInclude = {
  products: { select: { productId: true } },
  categories: { select: { categoryId: true } },
  collections: { select: { collectionId: true } },
  customers: { select: { userId: true } },
} satisfies Prisma.CouponInclude

export type CouponRecord = Prisma.CouponGetPayload<{ include: typeof couponInclude }>

export type Line = {
  id: string
  productId: string | null
  categoryId: string | null
  totalPrice: Prisma.Decimal
  quantity: number
}

/** Why a code did nothing, in words the customer can act on (§16). */
export type DiscountRefusal = { code: string; message: string; reason?: string }

export type DiscountResult =
  | { ok: true; total: Prisma.Decimal; perLine: Map<string, Prisma.Decimal> }
  | { ok: false; refusal: DiscountRefusal }

const ZERO = new Prisma.Decimal(0)
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)

/** The session's lines, with the two product facts a discount matches on. */
export async function sessionLines(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<Line[]> {
  const items = await tx.checkoutItem.findMany({
    where: { checkoutSessionId: sessionId },
    select: {
      id: true,
      quantity: true,
      totalPrice: true,
      variant: { select: { productId: true, product: { select: { categoryId: true } } } },
    },
  })

  return items.map((item) => ({
    id: item.id,
    productId: item.variant?.productId ?? null,
    categoryId: item.variant?.product?.categoryId ?? null,
    totalPrice: item.totalPrice,
    quantity: item.quantity,
  }))
}

/**
 * A category and everything under it.
 *
 * Choosing 'Men' has to cover 'Men > Sneakers', because products sit on leaves:
 * matching the chosen id alone would make a discount on a top-level category
 * apply to nothing at all, which looks identical to a broken discount.
 *
 * The tree is a few dozen rows, so it is loaded once and walked in memory.
 */
async function withDescendants(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Set<string>> {
  const wanted = new Set(ids)
  if (wanted.size === 0) return wanted

  const rows = await tx.category.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id])
  }

  const stack = [...wanted]
  while (stack.length > 0) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      if (wanted.has(child)) continue
      wanted.add(child)
      stack.push(child)
    }
  }
  return wanted
}

/**
 * Which of these lines the coupon covers.
 *
 * Collections are resolved as the storefront resolves them: a manual one by its
 * rows, a dynamic one by running its rules. A dynamic collection that has since
 * stopped matching a product stops discounting it, which is the whole point of
 * it being dynamic.
 */
async function coveredLineIds(
  tx: Prisma.TransactionClient,
  coupon: CouponRecord,
  lines: Line[],
): Promise<Set<string>> {
  const productIds = lines.map((line) => line.productId).filter(Boolean) as string[]
  if (productIds.length === 0) return new Set()

  if (coupon.appliesTo === 'PRODUCTS') {
    const chosen = new Set(coupon.products.map((row) => row.productId))
    return new Set(lines.filter((line) => line.productId && chosen.has(line.productId)).map((l) => l.id))
  }

  if (coupon.appliesTo === 'CATEGORIES') {
    const chosen = await withDescendants(tx, coupon.categories.map((row) => row.categoryId))
    return new Set(lines.filter((line) => line.categoryId && chosen.has(line.categoryId)).map((l) => l.id))
  }

  if (coupon.appliesTo === 'COLLECTIONS') {
    const collectionIds = coupon.collections.map((row) => row.collectionId)
    if (collectionIds.length === 0) return new Set()

    const collections = await tx.collection.findMany({
      where: { id: { in: collectionIds } },
      include: { rules: true },
    })

    const covered = new Set<string>()

    const manual = collections.filter((collection) => collection.type === 'MANUAL')
    if (manual.length > 0) {
      const links = await tx.collectionProduct.findMany({
        where: { collectionId: { in: manual.map((c) => c.id) }, productId: { in: productIds } },
        select: { productId: true },
      })
      for (const link of links) covered.add(link.productId)
    }

    for (const collection of collections.filter((c) => c.type === 'DYNAMIC')) {
      const where = await buildWhere(
        // The stored rows are widened JSON; the engine's own types narrow them.
        collection.rules.map((rule) => ({
          field: rule.field,
          operator: rule.operator as RuleInput['operator'],
          value: rule.value as RuleInput['value'],
        })),
        collection.matchType,
      )
      const matched = await tx.product.findMany({
        where: { AND: [where, { id: { in: productIds } }] },
        select: { id: true },
      })
      for (const product of matched) covered.add(product.id)
    }

    return new Set(lines.filter((line) => line.productId && covered.has(line.productId)).map((l) => l.id))
  }

  return new Set()
}

/**
 * The whole of §20, in the order a customer would ask it: does this code exist,
 * is it running, is it for me, does my basket qualify, and is there any of it
 * left.
 *
 * `usage` is counted from `coupon_redemptions` rather than from `used_count`,
 * because a code held by three checkouts that have not paid yet is three fewer
 * available — counting only completed orders is how a limited code oversells.
 */
export async function evaluate(
  tx: Prisma.TransactionClient,
  coupon: CouponRecord,
  input: { userId: string; lines: Line[]; sessionId: string; now?: Date },
): Promise<DiscountResult> {
  const now = input.now ?? new Date()

  if (coupon.startsAt && coupon.startsAt > now) {
    return {
      ok: false,
      refusal: { code: 'COUPON_NOT_STARTED', message: 'That code is not active yet' },
    }
  }
  if (coupon.endsAt && coupon.endsAt <= now) {
    return { ok: false, refusal: { code: 'COUPON_EXPIRED', message: 'That code has expired' } }
  }

  if (coupon.eligibility === 'SPECIFIC_CUSTOMERS') {
    const allowed = coupon.customers.some((row) => row.userId === input.userId)
    // Deliberately the same wording as an unknown code: telling a stranger that
    // a code is real but not for them is telling them it is worth hunting for.
    if (!allowed) {
      return {
        ok: false,
        refusal: { code: 'COUPON_NOT_FOUND', message: "That code isn't valid" },
      }
    }
  }

  if (coupon.usageLimit !== null) {
    const used = await tx.couponRedemption.count({
      where: {
        couponId: coupon.id,
        status: { in: ['ACTIVE', 'CONSUMED'] },
        NOT: { checkoutSessionId: input.sessionId },
      },
    })
    if (used >= coupon.usageLimit) {
      return {
        ok: false,
        refusal: { code: 'COUPON_EXHAUSTED', message: 'That code has been fully used' },
      }
    }
  }

  if (coupon.perUserLimit !== null) {
    const mine = await tx.couponRedemption.count({
      where: {
        couponId: coupon.id,
        userId: input.userId,
        status: { in: ['ACTIVE', 'CONSUMED'] },
        NOT: { checkoutSessionId: input.sessionId },
      },
    })
    if (mine >= coupon.perUserLimit) {
      return {
        ok: false,
        refusal: {
          code: 'COUPON_ALREADY_USED',
          message: 'You have already used that code',
          reason:
            coupon.perUserLimit === 1
              ? 'It can be used once per customer.'
              : `It can be used ${coupon.perUserLimit} times per customer.`,
        },
      }
    }
  }

  const covered = await coveredLineIds(tx, coupon, input.lines)
  const eligible = input.lines.filter((line) => covered.has(line.id))

  if (eligible.length === 0) {
    return {
      ok: false,
      refusal: {
        code: 'COUPON_NOT_APPLICABLE',
        message: "That code doesn't apply to anything in your bag",
        reason: 'It is limited to particular products.',
      },
    }
  }

  const eligibleTotal = eligible.reduce((sum, line) => sum.plus(line.totalPrice), ZERO)
  const eligibleQuantity = eligible.reduce((sum, line) => sum + line.quantity, 0)

  if (coupon.minRequirement === 'PURCHASE_AMOUNT' && coupon.minCartValue) {
    if (eligibleTotal.lessThan(coupon.minCartValue)) {
      return {
        ok: false,
        refusal: {
          code: 'COUPON_MINIMUM_NOT_MET',
          message: `Spend ₹${coupon.minCartValue.toFixed(0)} on eligible items to use that code`,
          reason: `Your eligible items come to ₹${eligibleTotal.toFixed(0)}.`,
        },
      }
    }
  }

  if (coupon.minRequirement === 'ITEM_QUANTITY' && coupon.minQuantity) {
    if (eligibleQuantity < coupon.minQuantity) {
      return {
        ok: false,
        refusal: {
          code: 'COUPON_MINIMUM_NOT_MET',
          message: `Add ${coupon.minQuantity} eligible items to use that code`,
          reason: `You have ${eligibleQuantity}.`,
        },
      }
    }
  }

  // ── what it is worth ──────────────────────────────────────────────────────
  let total =
    coupon.type === 'PERCENT'
      ? money(eligibleTotal.times(coupon.value).dividedBy(100))
      : money(coupon.value)

  if (coupon.type === 'PERCENT' && coupon.maxDiscountAmount) {
    if (total.greaterThan(coupon.maxDiscountAmount)) total = money(coupon.maxDiscountAmount)
  }
  // Never more than the goods it applies to: a ₹500 code on a ₹300 pair takes
  // ₹300, and the rest is not credit towards anything else.
  if (total.greaterThan(eligibleTotal)) total = money(eligibleTotal)

  if (total.lessThanOrEqualTo(ZERO)) {
    return {
      ok: false,
      refusal: { code: 'COUPON_NOT_APPLICABLE', message: "That code isn't worth anything here" },
    }
  }

  /**
   * Split across the lines it covers, in proportion to what each is worth, with
   * the remainder on the last one. Per line rather than a lump on the order,
   * because a refund of one item has to know what that item actually cost — and
   * `order_items.discount_amount` is where that lives (§19).
   */
  const perLine = new Map<string, Prisma.Decimal>()
  let allocated = ZERO
  eligible.forEach((line, index) => {
    const last = index === eligible.length - 1
    const share = last
      ? total.minus(allocated)
      : money(total.times(line.totalPrice).dividedBy(eligibleTotal))
    perLine.set(line.id, share)
    allocated = allocated.plus(share)
  })

  return { ok: true, total, perLine }
}

/**
 * Several codes on one cart, at most one discount on any line.
 *
 * Each coupon is costed independently first — its own eligible lines, its own
 * cap — and then every line is awarded to whichever coupon takes the most off
 * *that line*. A line is never discounted twice, and the customer is never
 * quietly given the worse of two codes they hold.
 *
 * The tie-break is the coupon applied first, which is the only order the
 * customer can see. Anything else — id, code, value — would make two identical
 * offers resolve by something they cannot reason about.
 *
 * A coupon can win nothing, and that is a real outcome rather than an error:
 * another code covered the same items for more. It stays applied and worth
 * zero, so the customer can see which one to take off.
 */
export function allocate(
  candidates: { couponId: string; perLine: Map<string, Prisma.Decimal> }[],
): { perLine: Map<string, { couponId: string; amount: Prisma.Decimal }>; perCoupon: Map<string, Prisma.Decimal> } {
  const perLine = new Map<string, { couponId: string; amount: Prisma.Decimal }>()

  for (const candidate of candidates) {
    for (const [lineId, amount] of candidate.perLine) {
      const standing = perLine.get(lineId)
      if (!standing || amount.greaterThan(standing.amount)) {
        perLine.set(lineId, { couponId: candidate.couponId, amount })
      }
    }
  }

  const perCoupon = new Map<string, Prisma.Decimal>(
    candidates.map((candidate) => [candidate.couponId, ZERO]),
  )
  for (const won of perLine.values()) {
    perCoupon.set(won.couponId, (perCoupon.get(won.couponId) ?? ZERO).plus(won.amount))
  }

  return { perLine, perCoupon }
}
