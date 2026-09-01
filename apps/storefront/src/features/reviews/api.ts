import { api, del, patch, post } from '@/lib/api-client'
import type { Review, ReviewListResponse } from '@/types/api'
import type { ReviewFormValues } from './schemas'

export type ReviewSort = 'newest' | 'oldest' | 'highest' | 'lowest'

export const reviewsApi = {
  /**
   * Not `get<T>()` — that unwraps `{ data }` and would throw away `meta`, which
   * carries the summary and this viewer's own review id.
   */
  list: async (slug: string, params: { page?: number; sort?: ReviewSort } = {}) => {
    const res = await api.get<ReviewListResponse>(
      `/products/${encodeURIComponent(slug)}/reviews`,
      { params },
    )
    return res.data
  },

  create: (slug: string, body: ReviewFormValues) =>
    post<Review>(`/products/${encodeURIComponent(slug)}/reviews`, body),

  update: (id: string, body: Partial<ReviewFormValues>) => patch<Review>(`/reviews/${id}`, body),

  remove: (id: string) => del(`/reviews/${id}`),
}
