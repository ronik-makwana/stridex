import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Discount, DiscountStateAction } from '@/types/api'
import { discountsApi, type DiscountValues } from './api'
import { discountKeys } from './queries'

/**
 * Every write invalidates the list and seeds the detail cache with what came
 * back — the server normalises the code to upper case and derives `state`, so
 * the answer is worth more than what was sent.
 */
function useWrite() {
  const queryClient = useQueryClient()
  return (discount: Discount) => {
    queryClient.setQueryData(discountKeys.detail(discount.id), discount)
    void queryClient.invalidateQueries({ queryKey: discountKeys.lists() })
  }
}

export function useCreateDiscount() {
  const write = useWrite()
  return useMutation({
    mutationFn: (values: DiscountValues) => discountsApi.create(values),
    onSuccess: write,
  })
}

export function useUpdateDiscount(id: string) {
  const write = useWrite()
  return useMutation({
    mutationFn: (values: DiscountValues) => discountsApi.update(id, values),
    onSuccess: write,
  })
}

export function useSetDiscountState() {
  const write = useWrite()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: DiscountStateAction }) =>
      discountsApi.setState(id, action),
    onSuccess: write,
  })
}

export function useDeleteDiscount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => discountsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: discountKeys.all }),
  })
}
