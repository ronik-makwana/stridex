import { Prisma, type Review } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import type { ReviewListQuery } from '../../schemas/shop/review.schema.js'

const REVIEW_ORDER: Record<ReviewListQuery['sort'], Prisma.ReviewOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }],
  oldest: [{ createdAt: 'asc' }],
  // Ties broken by recency, so an equal-rated page has a stable order rather
  // than whatever the planner returns that day.
  highest: [{ rating: 'desc' }, { createdAt: 'desc' }],
  lowest: [{ rating: 'asc' }, { createdAt: 'desc' }],
}

const reviewInclude = {
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ReviewInclude

/**
 * Which reviews a given viewer may see.
 *
 * PUBLISHED for everyone. A signed-in customer also sees their own HIDDEN
 * review — without that they would write it again, hit the unique constraint,
 * and get a 409 explaining nothing.
 */
function visibleTo(productId: string, userId?: string): Prisma.ReviewWhereInput {
  if (!userId) return { productId, status: 'PUBLISHED' }
  return {
    productId,
    OR: [{ status: 'PUBLISHED' }, { userId }],
  }
}

/**
 * Has this user actually bought this product?
 *
 * One indexed existence check over the whole page of reviews rather than per
 * row. Returns an empty set until Phase 15 writes a PAID order, so every review
 * reads unverified today — which is correct, not broken.
 */
export async function verifiedPurchaserIds(
  productId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()

  const rows = await prisma.order.findMany({
    where: {
      userId: { in: userIds },
      // The order was actually paid for. PENDING and FAILED prove nothing, and
      // REFUNDED means they no longer own it.
      paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
      items: { some: { variant: { productId } } },
    },
    select: { userId: true },
    distinct: ['userId'],
  })

  return new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))
}

export async function listReviews(
  productId: string,
  query: ReviewListQuery,
  viewerId?: string,
) {
  const where = visibleTo(productId, viewerId)

  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: reviewInclude,
      orderBy: REVIEW_ORDER[query.sort],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.review.count({ where }),
  ])

  return { rows, total }
}

/**
 * The summary counts every PUBLISHED review, not just the page — and
 * deliberately excludes the viewer's own hidden one, so a moderated review
 * cannot drag a public average that nobody else can see the cause of.
 */
export async function reviewSummary(productId: string) {
  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId, status: 'PUBLISHED' },
    _count: { rating: true },
  })
  return grouped.map((row) => ({ rating: row.rating, count: row._count.rating }))
}

export async function findMyReview(productId: string, userId: string): Promise<Review | null> {
  return prisma.review.findUnique({ where: { productId_userId: { productId, userId } } })
}

export async function createReview(
  productId: string,
  userId: string,
  data: { rating: number; body: string },
) {
  try {
    return await prisma.review.create({
      data: { productId, userId, rating: data.rating, body: data.body },
      include: reviewInclude,
    })
  } catch (error) {
    // The unique index is the guard, not a prior SELECT: two submissions in the
    // same tick both pass a check-then-insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('You have already reviewed this product', {
        review: 'Edit your existing review instead',
      })
    }
    throw error
  }
}

/**
 * Owner-scoped. Someone else's review id is a 403 rather than a 404: unlike a
 * product, the review is publicly visible on the page they are looking at, so
 * pretending it does not exist would be a lie the UI immediately contradicts.
 */
async function loadOwnReview(id: string, userId: string) {
  const review = await prisma.review.findUnique({ where: { id } })
  if (!review) throw notFound('Review')
  if (review.userId !== userId) throw forbidden('This review is not yours')
  return review
}

export async function updateReview(
  id: string,
  userId: string,
  data: { rating?: number; body?: string },
) {
  await loadOwnReview(id, userId)
  return prisma.review.update({
    where: { id },
    data: {
      ...(data.rating !== undefined ? { rating: data.rating } : {}),
      ...(data.body !== undefined ? { body: data.body } : {}),
    },
    include: reviewInclude,
  })
}

export async function deleteReview(id: string, userId: string): Promise<void> {
  await loadOwnReview(id, userId)
  await prisma.review.delete({ where: { id } })
}
