import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'

/**
 * The numbers on the first screen anybody opens.
 *
 * Two rules run through all of it. **Revenue counts PAID orders only** — a
 * pending checkout is not money, and a dashboard that says otherwise is a
 * dashboard nobody trusts twice. And **every "needs attention" line links to a
 * pre-filtered list**, because a count somebody cannot act on is decoration.
 */

const money = (value: Prisma.Decimal | null | undefined): string =>
  (value ?? new Prisma.Decimal(0)).toFixed(2)

/** The previous window of the same length, for the deltas. */
function previousWindow(from: Date, to: Date) {
  const span = to.getTime() - from.getTime()
  return { from: new Date(from.getTime() - span), to: from }
}

const percentChange = (current: number, previous: number): number | null => {
  // No baseline means no percentage. "↑ ∞%" is not a fact about the business.
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export async function summary(from: Date, to: Date) {
  const previous = previousWindow(from, to)
  const paid = { paymentStatus: 'PAID' } satisfies Prisma.OrderWhereInput

  const [revenue, orders, priorRevenue, priorOrders, products, drafts, customers, priorCustomers] =
    await Promise.all([
      prisma.order.aggregate({
        where: { ...paid, createdAt: { gte: from, lte: to } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: from, lte: to } } }),
      prisma.order.aggregate({
        where: { ...paid, createdAt: { gte: previous.from, lt: previous.to } },
        _sum: { totalAmount: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: previous.from, lt: previous.to } } }),
      prisma.product.count({ where: { status: 'ACTIVE' } }),
      prisma.product.count({ where: { status: 'DRAFT' } }),
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: from, lte: to } } }),
      prisma.user.count({
        where: { role: 'CUSTOMER', createdAt: { gte: previous.from, lt: previous.to } },
      }),
    ])

  const revenueNow = Number(revenue._sum.totalAmount ?? 0)
  const revenueBefore = Number(priorRevenue._sum.totalAmount ?? 0)

  return {
    revenue: {
      value: money(revenue._sum.totalAmount),
      /** Paid orders only — see the note at the top of this file. */
      orderCount: revenue._count._all,
      changePercent: percentChange(revenueNow, revenueBefore),
    },
    orders: { value: orders, changePercent: percentChange(orders, priorOrders) },
    products: { value: products, drafts },
    customers: { value: customers, changePercent: percentChange(customers, priorCustomers) },
    window: { from, to },
  }
}

/**
 * The sales chart, bucketed in SQL. `generate_series` fills the empty days —
 * a chart that silently skips a zero-revenue day draws a line between two
 * points a week apart and calls it a trend.
 */
export async function sales(from: Date, to: Date, interval: 'day' | 'week') {
  const unit = interval === 'week' ? 'week' : 'day'

  const rows = await prisma.$queryRaw<{ bucket: Date; revenue: string; orders: number }[]>`
    SELECT b.bucket,
           COALESCE(SUM(o.total_amount), 0)::text AS revenue,
           COUNT(o.id)::int AS orders
    FROM generate_series(
           date_trunc(${unit}, ${from}::timestamptz),
           date_trunc(${unit}, ${to}::timestamptz),
           ${`1 ${unit}`}::interval
         ) AS b(bucket)
    LEFT JOIN orders o
      ON date_trunc(${unit}, o.created_at) = b.bucket
     AND o.payment_status = 'PAID'
    GROUP BY b.bucket
    ORDER BY b.bucket
  `

  return rows.map((row) => ({
    at: row.bucket,
    revenue: Number(row.revenue).toFixed(2),
    orders: row.orders,
  }))
}

export async function recentOrders(limit = 6) {
  const rows = await prisma.order.findMany({
    include: { user: { select: { email: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return rows.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalAmount: money(order.totalAmount),
    customer: order.user
      ? [order.user.firstName, order.user.lastName].filter(Boolean).join(' ') || order.user.email
      : 'Guest',
    createdAt: order.createdAt,
  }))
}

/**
 * Low stock, by the operator's own per-variant threshold rather than one number
 * for the whole catalogue — the threshold on the inventory screen is what they
 * decided "low" means for that product.
 */
export async function lowStock(limit = 6) {
  const rows = await prisma.$queryRaw<
    {
      variant_id: string
      product_id: string
      title: string
      sku: string
      available: number
      threshold: number
    }[]
  >`
    SELECT pv.id AS variant_id, p.id AS product_id, p.title, pv.sku,
           GREATEST(i.quantity - i.reserved_quantity, 0)::int AS available,
           i.low_stock_threshold::int AS threshold
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    JOIN inventories i ON i.variant_id = pv.id
    WHERE pv.status = 'ACTIVE' AND p.status = 'ACTIVE'
      AND GREATEST(i.quantity - i.reserved_quantity, 0) <= i.low_stock_threshold
    ORDER BY available ASC, p.title ASC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    variantId: row.variant_id,
    productId: row.product_id,
    title: row.title,
    sku: row.sku,
    available: row.available,
    threshold: row.threshold,
  }))
}

export async function topProducts(from: Date, to: Date, limit = 5) {
  const rows = await prisma.$queryRaw<
    { product_title: string; sku: string; units: number; revenue: string }[]
  >`
    SELECT oi.product_title, oi.sku,
           SUM(oi.quantity)::int AS units,
           SUM(oi.total_price)::text AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.payment_status = 'PAID' AND o.created_at BETWEEN ${from} AND ${to}
    -- Grouped by the snapshot, not by the variant: a product renamed last week
    -- was still sold under the name on the order.
    GROUP BY oi.product_title, oi.sku
    ORDER BY units DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    title: row.product_title,
    sku: row.sku,
    units: row.units,
    revenue: Number(row.revenue).toFixed(2),
  }))
}

/**
 * The three things worth interrupting someone about, each with the filter that
 * shows exactly those rows. A number with no way through to the list behind it
 * is a number nobody acts on.
 */
export async function attention() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60_000)

  const [failedPayments, staleOrders, publishedNoStock] = await Promise.all([
    prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
    prisma.order.count({
      where: { status: 'PENDING', paymentStatus: 'PAID', createdAt: { lte: twoDaysAgo } },
    }),
    prisma.product.count({
      where: {
        status: 'ACTIVE',
        // Every active variant out of stock, which is what a customer sees as
        // "sold out" on a product that is still being advertised.
        variants: { every: { OR: [{ inventory: null }, { inventory: { quantity: { lte: 0 } } }] } },
      },
    }),
  ])

  return [
    {
      key: 'failed-payments',
      count: failedPayments,
      label: `${failedPayments} ${failedPayments === 1 ? 'payment' : 'payments'} failed in the last 24h`,
      to: '/payments?status=FAILED',
    },
    {
      key: 'stale-orders',
      count: staleOrders,
      label: `${staleOrders} paid ${staleOrders === 1 ? 'order' : 'orders'} unfulfilled for over 48h`,
      to: '/orders?status=PENDING&paymentStatus=PAID',
    },
    {
      key: 'published-no-stock',
      count: publishedNoStock,
      label: `${publishedNoStock} ${publishedNoStock === 1 ? 'product is' : 'products are'} published with zero stock`,
      to: '/products?status=ACTIVE&stock=out',
    },
  ].filter((line) => line.count > 0)
}

// ─── ⌘K ──────────────────────────────────────────────────────────────────────

/**
 * One query, three tables, few rows each. It is a jump-to, not a search page:
 * the answer somebody wants is usually the first row, and anything past five of
 * each is a list they should be looking at properly.
 */
export async function search(term: string) {
  const [products, orders, customers] = await Promise.all([
    prisma.product.findMany({
      where: { OR: [{ title: { contains: term, mode: 'insensitive' } }, { slug: { contains: term, mode: 'insensitive' } }] },
      select: { id: true, title: true, slug: true, status: true },
      take: 5,
    }),
    prisma.order.findMany({
      where: {
        OR: [
          { orderNumber: { contains: term, mode: 'insensitive' } },
          { user: { email: { contains: term, mode: 'insensitive' } } },
        ],
      },
      select: { id: true, orderNumber: true, status: true, paymentStatus: true, totalAmount: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, firstName: true, lastName: true },
      take: 5,
    }),
  ])

  return {
    products: products.map((product) => ({
      id: product.id,
      label: product.title,
      hint: product.status,
      to: `/products/${product.id}`,
    })),
    orders: orders.map((order) => ({
      id: order.id,
      label: order.orderNumber,
      hint: `${order.paymentStatus} · ${money(order.totalAmount)}`,
      to: `/orders/${order.id}`,
    })),
    customers: customers.map((customer) => ({
      id: customer.id,
      label: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email,
      hint: customer.email,
      to: `/customers/${customer.id}`,
    })),
  }
}
