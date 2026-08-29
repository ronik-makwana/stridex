import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import type { Brand, EntityStatus } from '@/types/api'
import { brandsApi } from './api'
import { brandKeys } from './queries'
import type { BrandValues } from './schemas'

/**
 * Every list key holds a different page or filter, so invalidating the whole
 * `brands` subtree is the only correct move after a write: a rename can move a
 * row between pages, and a status change can drop it out of a filtered view.
 */
function useInvalidateBrands() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: brandKeys.all })
}

export function useCreateBrand() {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: (values: BrandValues) => brandsApi.create(values),
    onSuccess: (brand) => {
      void invalidate()
      toast.success(`${brand.name} created`)
    },
  })
}

export function useUpdateBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<BrandValues> }) =>
      brandsApi.update(id, values),
    onSuccess: (brand) => {
      queryClient.setQueryData(brandKeys.detail(brand.id), brand)
      void queryClient.invalidateQueries({ queryKey: brandKeys.all })
      toast.success(`${brand.name} updated`)
    },
  })
}

export function useSetBrandStatus() {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntityStatus }) =>
      brandsApi.setStatus(id, status),
    onSuccess: (brand: Brand) => {
      void invalidate()
      toast.success(`${brand.name} is now ${brand.status.toLowerCase()}`)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not change the status')
    },
  })
}

export function useDeleteBrand() {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: (id: string) => brandsApi.remove(id),
    onSuccess: () => void invalidate(),
    // No toast here: a blocked delete is a 422 the dialog turns into an
    // explanation with a way forward, which a toast would talk over.
  })
}
