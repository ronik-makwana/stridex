import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReviewListQuery } from '@/types/api'
import { reviewsApi } from './api'

export const reviewKeys = {
  all: ['reviews'] as const,
  lists: () => [...reviewKeys.all, 'list'] as const,
  list: (query: ReviewListQuery) => [...reviewKeys.lists(), query] as const,
  counts: () => [...reviewKeys.all, 'counts'] as const,
}

export function useReviews(query: ReviewListQuery) {
  return useQuery({
    queryKey: reviewKeys.list(query),
    queryFn: () => reviewsApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useReviewCounts() {
  return useQuery({ queryKey: reviewKeys.counts(), queryFn: () => reviewsApi.counts() })
}
