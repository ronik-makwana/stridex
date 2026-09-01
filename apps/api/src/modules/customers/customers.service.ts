import { Prisma, type UserStatus } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeAdminCustomer,
  type AdminCustomerPayload,
  type CustomerTotals,
} from '../../serializers/admin/customer.serializer.js'
import { serializeAdminOrderRow } from '../../serializers/admin/order.serializer.js'
import type { CustomerListQuery } from '../../schemas/admin/customer.schema.js'

/**
 * Customers, for the person on the phone.
 *
 * Scoped to `role: CUSTOMER` everywhere — staff accounts are managed from
 * settings, and a support screen that could suspend an admin is a support
 * screen that can lock everyone out.
 */

const customerSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect

const SORT_COLUMNS = {
  created_at: 'createdAt',
  email: 'email',
} as const satisfies Record<string, keyof Prisma.UserOrderByWithRelationInput>

/**
 * Order count and lifetime spend for a page of customers, in one grouped query
 * rather than one per row. Only PAID orders count: a failed checkout is not
 * money anybody spent, and counting it would make every support conversation
 * start with an argument.
 */
async function loadTotals(userIds: string[]): Promise<Map<string, CustomerTotals>> {
  if (userIds.length === 0) return new Map()

  const rows = await prisma.order.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds }, paymentStatus: 'PAID' },
    _count: { _all: true },
    _sum: { totalAmount: true },
  })

  return new Map(
    rows.flatMap((row) =>
      row.userId ? [[row.userId, { orderCount: row._count._all, totalSpent: row._sum.totalAmount }]] : [],
    ),
  )
}

export async function findMany(query: CustomerListQuery) {
  const where: Prisma.UserWhereInput = { role: 'CUSTOMER' }

  if (query.status) where.status = query.status
  if (query.verified !== undefined) {
    where.emailVerifiedAt = query.verified ? { not: null } : null
  }
  if (query.q) {
    where.OR = [
      { email: { contains: query.q, mode: 'insensitive' } },
      { firstName: { contains: query.q, mode: 'insensitive' } },
      { lastName: { contains: query.q, mode: 'insensitive' } },
      { phone: { contains: query.q } },
    ]
  }

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: customerSelect,
      orderBy: [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ])

  const totals = await loadTotals(rows.map((row) => row.id))
  return {
    data: rows.map((row) => serializeAdminCustomer(row, totals.get(row.id))),
    total,
  }
}

async function loadOrThrow(id: string) {
  const customer = await prisma.user.findFirst({
    where: { id, role: 'CUSTOMER' },
    select: customerSelect,
  })
  // A staff id here is a 404 rather than a 403: this screen only knows about
  // customers, and saying "that is an admin" is a fact worth not confirming.
  if (!customer) throw notFound('Customer')
  return customer
}

export async function findById(id: string): Promise<AdminCustomerPayload> {
  const customer = await loadOrThrow(id)
  const totals = await loadTotals([id])
  return serializeAdminCustomer(customer, totals.get(id))
}

export async function orders(id: string, page: number, limit: number) {
  await loadOrThrow(id)

  const where = { userId: id } satisfies Prisma.OrderWhereInput
  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        items: true,
        addresses: true,
        statusHistory: { include: { changedBy: { select: { id: true, firstName: true, lastName: true } } } },
        payments: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ])

  return { data: rows.map(serializeAdminOrderRow), total }
}

export async function addresses(id: string) {
  await loadOrThrow(id)
  return prisma.address.findMany({
    where: { userId: id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
}

/**
 * What they are carrying right now. Read-only, and genuinely useful on a
 * support call — "it says out of stock" is answerable in one screen instead of
 * three.
 */
export async function basket(id: string) {
  await loadOrThrow(id)

  const [cart, wishlist] = await Promise.all([
    prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: { variant: { include: { product: { select: { title: true, slug: true } } } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
    prisma.wishlist.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: { product: { select: { id: true, title: true, slug: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
  ])

  return {
    cart: (cart?.items ?? []).map((item) => ({
      id: item.id,
      variantId: item.variantId,
      title: item.variant.product.title,
      slug: item.variant.product.slug,
      sku: item.variant.sku,
      quantity: item.quantity,
      price: item.variant.price.toFixed(2),
      addedAt: item.createdAt,
    })),
    wishlist: (wishlist?.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId,
      title: item.product.title,
      slug: item.product.slug,
      savedAt: item.createdAt,
    })),
  }
}

/**
 * Live sessions, so support can see 'signed in on three devices' and act on it.
 * Capped at fifty: this is a glance, not an audit, and revoke does not use this
 * list — it ends every live session whether or not it was shown here.
 */
export async function sessions(id: string) {
  await loadOrThrow(id)
  const rows = await prisma.userSession.findMany({
    where: { userId: id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.map((session) => ({
    id: session.id,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  }))
}

/**
 * Suspending does not end sessions on its own — that is a separate, deliberate
 * action, because the two are different decisions: "this account may not sign
 * in again" and "sign it out of everywhere right now".
 */
export async function setStatus(id: string, status: UserStatus): Promise<AdminCustomerPayload> {
  await loadOrThrow(id)
  await prisma.user.update({ where: { id }, data: { status } })
  return findById(id)
}

export async function revokeSessions(id: string): Promise<{ revoked: number }> {
  await loadOrThrow(id)
  const result = await prisma.userSession.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return { revoked: result.count }
}
