import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeShopOrder,
  serializeShopOrderCard,
  type ShopOrderCardPayload,
  type ShopOrderPayload,
} from '../../serializers/shop/order.serializer.js'
import type { OrderListQuery } from '../../schemas/shop/order.schema.js'

/**
 * Reading your own orders, and nobody else's.
 *
 * The scope is in the `where` on every query — never a read followed by a check
 * — so another customer's order number is a 404 rather than a 403 that confirms
 * it exists (§22). This is the opposite of the checkout rule, deliberately: an
 * order number is short, sequential and printed on emails, so confirming one
 * exists tells an attacker something real.
 */

const orderInclude = {
  items: {
    // Only to render a thumbnail and link back to the product. Every word and
    // number on the line comes from the snapshot columns (§19).
    include: {
      variant: {
        select: { product: { select: { slug: true, media: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
      },
    },
  },
  addresses: true,
  statusHistory: true,
  payments: true,
  /**
   * Which codes were actually spent on this order, and what each one took off.
   * `discountAmount` here is per coupon, so the lines sum to the order's total
   * discount rather than needing to be re-derived from it.
   */
  couponRedemptions: {
    where: { status: 'CONSUMED' },
    include: { coupon: { select: { code: true, kind: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderInclude

export async function findMany(
  userId: string,
  query: OrderListQuery,
): Promise<{ data: ShopOrderCardPayload[]; total: number }> {
  const where = { userId } satisfies Prisma.OrderWhereInput

  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: orderInclude,
      // Newest first, and `id` as the tiebreaker so two orders placed in the
      // same second cannot swap places between pages.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ])

  return { data: rows.map(serializeShopOrderCard), total }
}

export async function findByNumber(userId: string, orderNumber: string): Promise<ShopOrderPayload> {
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId },
    include: orderInclude,
  })
  if (!order) throw notFound('Order')
  return serializeShopOrder(order)
}
