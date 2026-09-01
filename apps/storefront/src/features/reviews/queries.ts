import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reviewsApi, type ReviewSort } from './api'
import type { ReviewFormValues } from './schemas'

export const reviewKeys = {
  list: (slug: string, page: number, sort: ReviewSort) =>
    ['reviews', slug, page, sort] as const,
  all: (slug: string) => ['reviews', slug] as const,
}

export function useReviews(slug: string, page: number, sort: ReviewSort) {
  return useQuery({
    queryKey: reviewKeys.list(slug, page, sort),
    queryFn: () => reviewsApi.list(slug, { page, sort }),
    enabled: Boolean(slug),
    // Someone else's review landing while you read is not worth a refetch, but
    // a stale average after your own write is — hence the invalidation below.
    staleTime: 30_000,
  })
}

/**
 * All three mutations invalidate the whole list for this product rather than
 * patching the cache. The summary, the distribution and `myReviewId` all move
 * when one review changes, and hand-reconciling four derived numbers is how a
 * page ends up showing "based on 3 reviews" above four of them.
 */
function useInvalidateReviews(slug: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: reviewKeys.all(slug) })
}

export function useCreateReview(slug: string) {
  const invalidate = useInvalidateReviews(slug)
  return useMutation({
    mutationFn: (values: ReviewFormValues) => reviewsApi.create(slug, values),
    onSuccess: invalidate,
  })
}

export function useUpdateReview(slug: string) {
  const invalidate = useInvalidateReviews(slug)
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: ReviewFormValues }) =>
      reviewsApi.update(id, values),
    onSuccess: invalidate,
  })
}

export function useDeleteReview(slug: string) {
  const invalidate = useInvalidateReviews(slug)
  return useMutation({
    mutationFn: (id: string) => reviewsApi.remove(id),
    onSuccess: invalidate,
  })
}
