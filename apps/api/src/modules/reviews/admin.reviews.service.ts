import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeAdminReview,
  type AdminReviewPayload,
} from '../../serializers/admin/review.serializer.js'
import type { ReviewListQuery } from '../../schemas/admin/review.schema.js'

/**
 * Moderation, and the two tools are deliberately different.
 *
 * **Hiding** is reversible and leaves the review where it is: the author still
 * sees their own, which is what stops them writing it again and meeting a 409
 * that explains nothing. It is the right answer for a review that is unfair,
 * off-topic, or names a competitor.
 *
 * **Deleting** frees the `unique(product_id, user_id)` slot, so the customer
 * can write another. It is the right answer for abuse, and the wrong answer for
 * a bad rating — a one-star review that is simply true is not a moderation
 * problem.
 */

const reviewInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  product: { select: { id: true, title: true, slug: true } },
} satisfies Prisma.ReviewInclude

const SORT_COLUMNS = {
  created_at: 'createdAt',
  rating: 'rating',
} as const satisfies Record<string, keyof Prisma.ReviewOrderByWithRelationInput>

/**
 * Which of these authors actually bought what they reviewed, for a whole page
 * in one query. Same rule as the storefront's: a paid order containing the
 * product, refunds excluded.
 */
async function verifiedPairs(
  rows: { productId: string; userId: string }[],
): Promise<Set<string>> {
  if (rows.length === 0) return new Set()

  const orders = await prisma.order.findMany({
    where: {
      userId: { in: [...new Set(rows.map((row) => row.userId))] },
      paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
      items: { some: { variant: { productId: { in: rows.map((row) => row.productId) } } } },
    },
    select: { userId: true, items: { select: { variant: { select: { productId: true } } } } },
  })

  const pairs = new Set<string>()
  for (const order of orders) {
    for (const item of order.items) {
      if (order.userId && item.variant) pairs.add(`${order.userId}:${item.variant.productId}`)
    }
  }
  return pairs
}

export async function findMany(
  query: ReviewListQuery,
): Promise<{ data: AdminReviewPayload[]; total: number }> {
  const where: Prisma.ReviewWhereInput = {}
  if (query.status) where.status = query.status
  if (query.rating) where.rating = query.rating
  if (query.productId) where.productId = query.productId
  if (query.q) {
    where.OR = [
      { body: { contains: query.q, mode: 'insensitive' } },
      { product: { title: { contains: query.q, mode: 'insensitive' } } },
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
    ]
  }

  const [rows, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      include: reviewInclude,
      orderBy: [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.review.count({ where }),
  ])

  const verified = await verifiedPairs(rows)
  return {
    data: rows.map((row) =>
      serializeAdminReview(row, verified.has(`${row.userId}:${row.productId}`)),
    ),
    total,
  }
}

async function loadOrThrow(id: string) {
  const review = await prisma.review.findUnique({ where: { id }, include: reviewInclude })
  if (!review) throw notFound('Review')
  return review
}

export async function setStatus(
  id: string,
  status: 'PUBLISHED' | 'HIDDEN',
): Promise<AdminReviewPayload> {
  await loadOrThrow(id)
  await prisma.review.update({ where: { id }, data: { status } })
  const review = await loadOrThrow(id)
  const verified = await verifiedPairs([review])
  return serializeAdminReview(review, verified.has(`${review.userId}:${review.productId}`))
}

/** For abuse. Hiding is the tool for everything short of it — see the note above. */
export async function remove(id: string): Promise<void> {
  await loadOrThrow(id)
  await prisma.review.delete({ where: { id } })
}

/** The counts behind the queue's tabs, so moderation knows what is waiting. */
export async function counts() {
  const rows = await prisma.review.groupBy({ by: ['status'], _count: { _all: true } })
  const byStatus = new Map(rows.map((row) => [row.status, row._count._all]))
  return {
    published: byStatus.get('PUBLISHED') ?? 0,
    hidden: byStatus.get('HIDDEN') ?? 0,
    total: (byStatus.get('PUBLISHED') ?? 0) + (byStatus.get('HIDDEN') ?? 0),
  }
}
