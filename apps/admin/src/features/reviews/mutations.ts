import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReviewStatus } from '@/types/api'
import { reviewsApi } from './api'
import { reviewKeys } from './queries'

/**
 * Both writes invalidate the whole subtree, counts included: hiding a review
 * moves it between the queue's tabs, and a count that lags is a count that
 * sends somebody to an empty list.
 */
function useInvalidate() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: reviewKeys.all })
}

export function useSetReviewStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReviewStatus }) =>
      reviewsApi.setStatus(id, status),
    onSuccess: invalidate,
  })
}

export function useDeleteReview() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => reviewsApi.remove(id), onSuccess: invalidate })
}
