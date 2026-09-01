import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { AppError, notFound } from '../../lib/errors.js'
import {
  serializeAdminDiscount,
  serializeAdminDiscountRow,
  type AdminDiscountPayload,
} from '../../serializers/admin/discount.serializer.js'
import type {
  CreateDiscountInput,
  DiscountListQuery,
  UpdateDiscountInput,
} from '../../schemas/admin/discount.schema.js'

/**
 * Discount codes, from the admin side.
 *
 * Nothing here applies a discount to anything — that lands in the checkout
 * quote, in the one function that decides money (§21). This module's whole job
 * is to store a definition that the quote can later read, and to make sure a
 * definition that cannot mean anything is never stored in the first place.
 */

const include = {
  products: { include: { product: { select: { id: true, title: true } } } },
  // The parent comes too: 'Sneakers' exists under Men and under Women, and a
  // chip that says only 'Sneakers' cannot be told from the other one.
  categories: {
    include: {
      category: { select: { id: true, name: true, parent: { select: { name: true } } } },
    },
  },
  collections: { include: { collection: { select: { id: true, name: true } } } },
  customers: {
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  },
} satisfies Prisma.CouponInclude

const SORT_COLUMNS = {
  code: 'code',
  created_at: 'createdAt',
  used_count: 'usedCount',
} as const satisfies Record<string, keyof Prisma.CouponOrderByWithRelationInput>

/**
 * `state` is derived from the clock, so it is filtered as dates rather than as
 * a column. Doing it in SQL keeps the pagination honest — filtering after the
 * page is cut gives you a page of four rows and a count that says twenty.
 */
function stateFilter(state: DiscountListQuery['state'], now: Date): Prisma.CouponWhereInput {
  switch (state) {
    case 'EXPIRED':
      return { endsAt: { not: null, lte: now } }
    case 'SCHEDULED':
      return { startsAt: { gt: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }
    case 'ACTIVE':
      return {
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      }
    default:
      return {}
  }
}

export async function findMany(query: DiscountListQuery) {
  const now = new Date()
  const where: Prisma.CouponWhereInput = { ...stateFilter(query.state, now) }
  if (query.kind) where.kind = query.kind
  if (query.q) {
    where.OR = [
      { code: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await prisma.$transaction([
    prisma.coupon.findMany({
      where,
      include,
      orderBy: [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.coupon.count({ where }),
  ])

  return { data: rows.map(serializeAdminDiscountRow), total }
}

async function loadOrThrow(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id }, include })
  if (!coupon) throw notFound('Discount')
  return coupon
}

export async function findById(id: string): Promise<AdminDiscountPayload> {
  return serializeAdminDiscount(await loadOrThrow(id))
}

/**
 * Only the ids the chosen `appliesTo` actually uses are kept.
 *
 * A form that switched from products to collections and back leaves both lists
 * populated in its state; storing the pair would leave a discount whose stored
 * rows disagree with what it says it applies to, and the quote reading it later
 * would have to guess which one the operator meant.
 */
function targets(input: CreateDiscountInput) {
  const product = input.kind === 'PRODUCT'
  return {
    productIds: product && input.appliesTo === 'PRODUCTS' ? input.productIds : [],
    categoryIds: product && input.appliesTo === 'CATEGORIES' ? input.categoryIds : [],
    collectionIds: product && input.appliesTo === 'COLLECTIONS' ? input.collectionIds : [],
    customerIds: input.eligibility === 'SPECIFIC_CUSTOMERS' ? input.customerIds : [],
  }
}

/** Same reasoning: a cleared requirement must not leave its old number behind. */
function scalars(input: CreateDiscountInput) {
  return {
    code: input.code,
    description: input.description,
    kind: input.kind,
    type: input.type,
    value: new Prisma.Decimal(input.value),
    maxDiscountAmount:
      input.type === 'PERCENT' && input.maxDiscountAmount
        ? new Prisma.Decimal(input.maxDiscountAmount)
        : null,
    appliesTo: input.kind === 'PRODUCT' ? (input.appliesTo ?? null) : null,
    eligibility: input.eligibility,
    minRequirement: input.minRequirement,
    minCartValue:
      input.minRequirement === 'PURCHASE_AMOUNT' && input.minCartValue
        ? new Prisma.Decimal(input.minCartValue)
        : null,
    minQuantity: input.minRequirement === 'ITEM_QUANTITY' ? input.minQuantity : null,
    maxShippingAmount:
      input.kind === 'SHIPPING' && input.maxShippingAmount
        ? new Prisma.Decimal(input.maxShippingAmount)
        : null,
    usageLimit: input.usageLimit,
    perUserLimit: input.perUserLimit,
    combinesWithProduct: input.combinesWithProduct,
    combinesWithOrder: input.combinesWithOrder,
    combinesWithShipping: input.combinesWithShipping,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    // The column stays ACTIVE for every discount. What decides whether one is
    // live is the pair of dates above, and having a second thing that could
    // say otherwise is how the two end up disagreeing.
    status: 'ACTIVE' as const,
  }
}

/**
 * Every id is checked against what exists before anything is written. A
 * discount pointing at a deleted product is a discount that throws the first
 * time somebody tries to use it — better a 422 on the form than a 500 at
 * checkout.
 */
async function assertTargetsExist(chosen: ReturnType<typeof targets>) {
  const fields: Record<string, string> = {}

  const checks: [string[], () => Promise<number>, string, string][] = [
    [chosen.productIds, () => prisma.product.count({ where: { id: { in: chosen.productIds } } }), 'productIds', 'product'],
    [chosen.categoryIds, () => prisma.category.count({ where: { id: { in: chosen.categoryIds } } }), 'categoryIds', 'category'],
    [chosen.collectionIds, () => prisma.collection.count({ where: { id: { in: chosen.collectionIds } } }), 'collectionIds', 'collection'],
    [
      chosen.customerIds,
      () => prisma.user.count({ where: { id: { in: chosen.customerIds }, role: 'CUSTOMER' } }),
      'customerIds',
      'customer',
    ],
  ]

  for (const [ids, count, field, label] of checks) {
    if (ids.length === 0) continue
    if ((await count()) !== new Set(ids).size) {
      fields[field] = `One of those ${label} records no longer exists`
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Some of the selections are out of date', {
      reason: 'Reopen the picker and choose again.',
      fields,
    })
  }
}

/** The unique index on `code` is what settles a duplicate, not a prior SELECT (§15). */
function asDuplicateCode(error: unknown): never | void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(409, 'CONFLICT', 'That discount code is already in use', {
      fields: { code: 'Pick a different code' },
    })
  }
}

export async function create(input: CreateDiscountInput): Promise<AdminDiscountPayload> {
  const chosen = targets(input)
  await assertTargetsExist(chosen)

  try {
    const created = await prisma.coupon.create({
      data: {
        ...scalars(input),
        products: { create: chosen.productIds.map((productId) => ({ productId })) },
        categories: { create: chosen.categoryIds.map((categoryId) => ({ categoryId })) },
        collections: { create: chosen.collectionIds.map((collectionId) => ({ collectionId })) },
        customers: { create: chosen.customerIds.map((userId) => ({ userId })) },
      },
      include,
    })
    return serializeAdminDiscount(created)
  } catch (error) {
    asDuplicateCode(error)
    throw error
  }
}

/**
 * Replace, not patch — and in one transaction, because a discount that has
 * dropped its old products and not yet gained its new ones is a discount that
 * applies to everything for as long as that window lasts.
 */
export async function update(id: string, input: UpdateDiscountInput): Promise<AdminDiscountPayload> {
  await loadOrThrow(id)
  const chosen = targets(input)
  await assertTargetsExist(chosen)

  try {
    await prisma.$transaction([
      prisma.couponProduct.deleteMany({ where: { couponId: id } }),
      prisma.couponCategory.deleteMany({ where: { couponId: id } }),
      prisma.couponCollection.deleteMany({ where: { couponId: id } }),
      prisma.couponCustomer.deleteMany({ where: { couponId: id } }),
      prisma.coupon.update({
        where: { id },
        data: {
          ...scalars(input),
          products: { create: chosen.productIds.map((productId) => ({ productId })) },
          categories: { create: chosen.categoryIds.map((categoryId) => ({ categoryId })) },
          collections: { create: chosen.collectionIds.map((collectionId) => ({ collectionId })) },
          customers: { create: chosen.customerIds.map((userId) => ({ userId })) },
        },
      }),
    ])
  } catch (error) {
    asDuplicateCode(error)
    throw error
  }

  return serializeAdminDiscount(await loadOrThrow(id))
}

/**
 * Stop it, or start it again — by moving the only thing that decides.
 *
 * Deactivating writes `ends_at = now`, so the discount is over from this moment
 * and the reason is legible in the record: it ran until here. Activating clears
 * the end date rather than pushing it into the future, because "no end" is what
 * an operator means by "back on" — a discount that quietly expires again in a
 * week is worse than one they have to stop by hand.
 *
 * The clock is the server's. A client that sent its own date would be a client
 * that could deactivate something yesterday.
 */
export async function setState(
  id: string,
  action: 'ACTIVATE' | 'DEACTIVATE',
): Promise<AdminDiscountPayload> {
  const coupon = await loadOrThrow(id)
  const now = new Date()

  const data =
    action === 'DEACTIVATE'
      ? { endsAt: now }
      : {
          endsAt: null,
          // An expired discount whose *start* is also in the past comes back
          // immediately; one still waiting to start keeps waiting. Reactivating
          // must not silently drag a scheduled launch forward.
          ...(coupon.startsAt && coupon.startsAt > now ? {} : { startsAt: coupon.startsAt ?? now }),
        }

  await prisma.coupon.update({ where: { id }, data })
  return serializeAdminDiscount(await loadOrThrow(id))
}

/**
 * A discount that has been used is history, and history is not deleted: the
 * orders it discounted point at it through `coupon_redemptions`, and removing
 * the row would leave those orders unable to say why they were cheaper (§19).
 * Archiving takes it out of circulation and keeps the record.
 */
export async function remove(id: string): Promise<void> {
  await loadOrThrow(id)
  const redeemed = await prisma.couponRedemption.count({ where: { couponId: id } })
  if (redeemed > 0) {
    throw new AppError(409, 'CONFLICT', 'This discount has been used', {
      reason: 'Archive it instead — deleting it would leave those orders unexplained.',
    })
  }
  await prisma.coupon.delete({ where: { id } })
}
