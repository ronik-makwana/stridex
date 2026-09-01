import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { TestimonialListQuery } from '@/types/api'
import { testimonialsApi } from './api'

export const testimonialKeys = {
  all: ['testimonials'] as const,
  list: (query: TestimonialListQuery) => [...testimonialKeys.all, 'list', query] as const,
}

export function useTestimonials(query: TestimonialListQuery) {
  return useQuery({
    queryKey: testimonialKeys.list(query),
    queryFn: () => testimonialsApi.list(query),
    placeholderData: keepPreviousData,
  })
}
