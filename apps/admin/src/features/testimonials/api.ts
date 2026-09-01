import { api, del, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  EntityStatus,
  Testimonial,
  TestimonialListQuery,
} from '@/types/api'

export type TestimonialValues = {
  quote: string
  authorName: string
  authorRole?: string | null
  rating?: number | null
  imageUrl?: string | null
  status?: EntityStatus
}

export const testimonialsApi = {
  list: async (params: TestimonialListQuery) => {
    const response = await api.get<ApiListResponse<Testimonial>>('/testimonials', { params })
    return response.data
  },
  create: (body: TestimonialValues) => post<Testimonial>('/testimonials', body),
  update: (id: string, body: Partial<TestimonialValues>) =>
    patch<Testimonial>(`/testimonials/${id}`, body),
  setStatus: (id: string, status: EntityStatus) =>
    patch<Testimonial>(`/testimonials/${id}/status`, { status }),
  remove: (id: string) => del(`/testimonials/${id}`),
}
