import type { Prisma } from '@shoe/db'
import { money } from '../shop/money.js'

/**
 * A discount as the admin screens read it.
 *
 * The one thing worth explaining is `state`. The stored `status` is what the
 * operator set — DRAFT or ACTIVE — and it is not the whole truth: an active
 * discount whose end date has passed is expired, and one whose start date has
 * not arrived is scheduled. Both are facts about the clock, so both are derived
 * here rather than written by a job that might not have run yet.
 */

export type AdminDiscountRecord = Prisma.CouponGetPayload<{
  include: {
    products: { include: { product: { select: { id: true; title: true } } } }
    categories: {
      include: { category: { select: { id: true; name: true; parent: { select: { name: true } } } } }
    }
    collections: { include: { collection: { select: { id: true; name: true } } } }
    customers: {
      include: { user: { select: { id: true; email: true; firstName: true; lastName: true } } }
    }
  }
}>

export type DiscountState = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED'

/**
 * Three states, all of them read off the clock.
 *
 * There is no stored status to disagree with the dates: a discount is expired
 * because its end has passed, scheduled because its start has not arrived, and
 * active the rest of the time. That is why "deactivate" is *set the end date to
 * now* and "activate" is *clear it* — the buttons move the only thing that
 * decides, instead of setting a flag that a date could then contradict.
 */
export function discountState(
  coupon: { startsAt: Date | null; endsAt: Date | null },
  now = new Date(),
): DiscountState {
  if (coupon.endsAt && coupon.endsAt <= now) return 'EXPIRED'
  if (coupon.startsAt && coupon.startsAt > now) return 'SCHEDULED'
  return 'ACTIVE'
}

function customerName(user: { firstName: string | null; lastName: string | null; email: string }) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
  return name || user.email
}

export function serializeAdminDiscount(coupon: AdminDiscountRecord) {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    kind: coupon.kind,
    type: coupon.type,
    value: money(coupon.value),
    maxDiscountAmount: coupon.maxDiscountAmount ? money(coupon.maxDiscountAmount) : null,

    appliesTo: coupon.appliesTo,
    products: coupon.products.map((row) => ({ id: row.product.id, name: row.product.title })),
    categories: coupon.categories.map((row) => ({
      id: row.category.id,
      name: row.category.parent
        ? `${row.category.parent.name} > ${row.category.name}`
        : row.category.name,
    })),
    collections: coupon.collections.map((row) => ({
      id: row.collection.id,
      name: row.collection.name,
    })),

    eligibility: coupon.eligibility,
    customers: coupon.customers.map((row) => ({
      id: row.user.id,
      name: customerName(row.user),
      email: row.user.email,
    })),

    minRequirement: coupon.minRequirement,
    minCartValue: coupon.minCartValue ? money(coupon.minCartValue) : null,
    minQuantity: coupon.minQuantity,
    /** Shipping discounts: the rate above which this does not apply. */
    maxShippingAmount: coupon.maxShippingAmount ? money(coupon.maxShippingAmount) : null,

    usageLimit: coupon.usageLimit,
    perUserLimit: coupon.perUserLimit,
    /** Counted from `coupon_redemptions`, not incremented hopefully by a client. */
    usedCount: coupon.usedCount,

    combinesWithProduct: coupon.combinesWithProduct,
    combinesWithOrder: coupon.combinesWithOrder,
    combinesWithShipping: coupon.combinesWithShipping,

    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,

    state: discountState(coupon),
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
  }
}

/** The list needs less: no relation rows, just enough to scan and to filter. */
export function serializeAdminDiscountRow(coupon: AdminDiscountRecord) {
  const full = serializeAdminDiscount(coupon)
  return {
    id: full.id,
    code: full.code,
    kind: full.kind,
    type: full.type,
    value: full.value,
    appliesTo: full.appliesTo,
    /** "3 products", "2 collections" — what it covers, without the rows. */
    targetCount:
      full.appliesTo === 'PRODUCTS'
        ? full.products.length
        : full.appliesTo === 'CATEGORIES'
          ? full.categories.length
          : full.appliesTo === 'COLLECTIONS'
            ? full.collections.length
            : 0,
    eligibility: full.eligibility,
    customerCount: full.customers.length,
    usageLimit: full.usageLimit,
    usedCount: full.usedCount,
    /** The three combination flags: the list shows them as icons, lit or not. */
    combinesWithProduct: full.combinesWithProduct,
    combinesWithOrder: full.combinesWithOrder,
    combinesWithShipping: full.combinesWithShipping,
    startsAt: full.startsAt,
    endsAt: full.endsAt,
    state: full.state,
    createdAt: full.createdAt,
  }
}

export type AdminDiscountPayload = ReturnType<typeof serializeAdminDiscount>
export type AdminDiscountRow = ReturnType<typeof serializeAdminDiscountRow>
