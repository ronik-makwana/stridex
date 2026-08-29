import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { VariantOption, VariantOptionValue } from '@/types/api'
import { variantOptionsApi } from './api'
import { variantOptionKeys } from './queries'
import type { OptionValueValues, VariantOptionValues } from './schemas'

/**
 * Every list key holds a different page or filter, so invalidating the whole
 * `variant-options` subtree is the only correct move after a write: a rename
 * can move a row between pages, and a value change moves the values count.
 */
function useInvalidateVariantOptions() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: variantOptionKeys.all })
}

export function useCreateVariantOption() {
  const invalidate = useInvalidateVariantOptions()
  return useMutation({
    mutationFn: (values: VariantOptionValues) => variantOptionsApi.create(values),
    onSuccess: (option) => {
      void invalidate()
      toast.success(`${option.name} created`)
    },
  })
}

export function useUpdateVariantOption() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<VariantOptionValues> }) =>
      variantOptionsApi.update(id, values),
    onSuccess: (option) => {
      // PATCH answers without values; keeping the cached ones avoids blanking
      // the panel underneath while the refetch is in flight.
      queryClient.setQueryData<VariantOption>(variantOptionKeys.detail(option.id), (current) =>
        current ? { ...option, values: current.values } : option,
      )
      void queryClient.invalidateQueries({ queryKey: variantOptionKeys.all })
      toast.success(`${option.name} updated`)
    },
  })
}

export function useDeleteVariantOption() {
  const invalidate = useInvalidateVariantOptions()
  return useMutation({
    mutationFn: (id: string) => variantOptionsApi.remove(id),
    onSuccess: () => void invalidate(),
    // No toast here: a blocked delete is a 422 the dialog turns into an
    // explanation with a way forward, which a toast would talk over.
  })
}

// ─── values ──────────────────────────────────────────────────────────────────

export function useCreateOptionValue(optionId: string) {
  const invalidate = useInvalidateVariantOptions()
  return useMutation({
    mutationFn: (values: OptionValueValues) => variantOptionsApi.createValue(optionId, values),
    onSuccess: (value) => {
      void invalidate()
      toast.success(`${value.value} added`)
    },
  })
}

export function useUpdateOptionValue(optionId: string) {
  const invalidate = useInvalidateVariantOptions()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<OptionValueValues> }) =>
      variantOptionsApi.updateValue(optionId, id, values),
    onSuccess: () => void invalidate(),
  })
}

export function useDeleteOptionValue(optionId: string) {
  const invalidate = useInvalidateVariantOptions()
  return useMutation({
    mutationFn: (id: string) => variantOptionsApi.removeValue(optionId, id),
    onSuccess: () => void invalidate(),
  })
}

export function useReorderOptionValues(optionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => variantOptionsApi.reorderValues(optionId, ids),
    onSuccess: (values: VariantOptionValue[]) => {
      // The response is the settled order. Writing it straight into the cache
      // keeps the list still — an invalidate would refetch and re-animate a
      // list the operator just finished dragging.
      queryClient.setQueryData<VariantOption>(variantOptionKeys.detail(optionId), (current) =>
        current ? { ...current, values } : current,
      )
    },
  })
}
