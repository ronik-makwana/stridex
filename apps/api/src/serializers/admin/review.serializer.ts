import type { Prisma } from '@shoe/db'

/**
 * A review as a moderator sees it: the words, who wrote them, what they are
 * about, and whether that person actually bought the thing.
 *
 * The author's email is here and is not on the storefront payload — moderation
 * is exactly the case where you need to know *who*, and a public page is
 * exactly the case where you must not say.
 */
export type AdminReviewRecord = Prisma.ReviewGetPayload<{
  include: {
    user: { select: { id: true; email: true; firstName: true; lastName: true } }
    product: { select: { id: true; title: true; slug: true } }
  }
}>

export function serializeAdminReview(review: AdminReviewRecord, verified: boolean) {
  return {
    id: review.id,
    rating: review.rating,
    body: review.body,
    status: review.status,
    product: review.product,
    author: {
      id: review.user.id,
      email: review.user.email,
      name: [review.user.firstName, review.user.lastName].filter(Boolean).join(' ') || null,
    },
    /**
     * Derived per query — does this account have a paid order containing the
     * product — never stored. A refund changes the answer, and a stored flag
     * would have to be kept true forever.
     */
    verifiedPurchase: verified,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  }
}

export type AdminReviewPayload = ReturnType<typeof serializeAdminReview>
