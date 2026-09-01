import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EntityStatus } from '@/types/api'
import { testimonialsApi, type TestimonialValues } from './api'
import { testimonialKeys } from './queries'

/** Publishing moves a quote onto the front page, so every write refetches. */
function useInvalidate() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: testimonialKeys.all })
}

export function useCreateTestimonial() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (values: TestimonialValues) => testimonialsApi.create(values),
    onSuccess: invalidate,
  })
}

export function useUpdateTestimonial() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<TestimonialValues> }) =>
      testimonialsApi.update(id, values),
    onSuccess: invalidate,
  })
}

export function useSetTestimonialStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntityStatus }) =>
      testimonialsApi.setStatus(id, status),
    onSuccess: invalidate,
  })
}

export function useDeleteTestimonial() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => testimonialsApi.remove(id), onSuccess: invalidate })
}
