import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address } from '@/types/api'
import { addressesApi } from './api'
import { addressKeys } from './queries'
import type { AddressValues } from './schemas'

/**
 * Every write invalidates the list rather than patching it. The reason is the
 * default flag: promoting one address demotes another, and a cache that only
 * knew about the row it just wrote would show two defaults until the next
 * refetch.
 */
function useInvalidate() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: addressKeys.all })
}

export function useCreateAddress() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (values: AddressValues) => addressesApi.create(values),
    onSuccess: invalidate,
  })
}

export function useUpdateAddress() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<AddressValues> }) =>
      addressesApi.update(id, values),
    onSuccess: invalidate,
  })
}

export function useDeleteAddress() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => addressesApi.remove(id),
    onSuccess: invalidate,
  })
}

export function useSetDefaultAddress() {
  const invalidate = useInvalidate()
  return useMutation<Address, Error, string>({
    mutationFn: (id: string) => addressesApi.setDefault(id),
    onSuccess: invalidate,
  })
}
