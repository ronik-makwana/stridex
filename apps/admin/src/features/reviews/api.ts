import { api, del, get, patch } from '@/lib/api-client'
import type { ApiListResponse, Review, ReviewCounts, ReviewListQuery, ReviewStatus } from '@/types/api'

/**
 * Three verbs, and no way to edit the words. A review belongs to the person who
 * wrote it; moderation decides whether it is shown, not what it says.
 */
export const reviewsApi = {
  list: async (params: ReviewListQuery) => {
    const response = await api.get<ApiListResponse<Review>>('/reviews', { params })
    return response.data
  },

  counts: () => get<ReviewCounts>('/reviews/counts'),

  setStatus: (id: string, status: ReviewStatus) =>
    patch<Review>(`/reviews/${id}/status`, { status }),

  /** For abuse. Hiding is the tool for everything short of it. */
  remove: (id: string) => del(`/reviews/${id}`),
}
