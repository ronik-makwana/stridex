import type { Review, User } from '@shoe/db'

type ReviewRow = Review & {
  user: Pick<User, 'id' | 'firstName' | 'lastName'>
}

/**
 * A review as the storefront shows it.
 *
 * The author is a display name only — never the email. A reviews list is
 * public, and publishing the address of everyone who ever bought a pair of
 * shoes is a data leak that no one would sign off on if it were proposed
 * directly.
 */
function authorName(user: ReviewRow['user']): string {
  const first = user.firstName?.trim()
  const lastInitial = user.lastName?.trim()?.[0]
  if (first && lastInitial) return `${first} ${lastInitial}.`
  if (first) return first
  return 'Customer'
}

export function serializeShopReview(
  review: ReviewRow,
  options: { verifiedPurchase: boolean; currentUserId?: string | undefined },
) {
  return {
    id: review.id,
    rating: review.rating,
    body: review.body,
    author: authorName(review.user),
    /**
     * Derived per request, never stored — a refund or a chargeback would
     * falsify a stored flag and nothing would go back and fix it. Reads false
     * for everyone until Phase 15 produces a PAID order.
     */
    verifiedPurchase: options.verifiedPurchase,
    /** Lets the UI offer edit and delete without a second ownership check. */
    isMine: Boolean(options.currentUserId && options.currentUserId === review.userId),
    /**
     * Only ever HIDDEN on the author's own review — see the service. Everyone
     * else never receives a hidden row at all, so this cannot leak moderation
     * decisions about other people.
     */
    status: review.status,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  }
}

export type ShopReviewPayload = ReturnType<typeof serializeShopReview>

/**
 * The rating summary. Computed per request from one grouped query rather than
 * read off a denormalised column on `products`, which would be a second source
 * of truth that drifts the first time a moderator hides a review.
 */
export function serializeReviewSummary(counts: { rating: number; count: number }[]) {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let total = 0
  let weighted = 0

  for (const row of counts) {
    const rating = row.rating as 1 | 2 | 3 | 4 | 5
    distribution[rating] = row.count
    total += row.count
    weighted += rating * row.count
  }

  return {
    // Rounded to two places for display; the raw mean is not more honest, it is
    // just longer.
    average: total === 0 ? 0 : Number((weighted / total).toFixed(2)),
    total,
    distribution,
  }
}
