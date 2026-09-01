import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Order } from '@/types/api'
import { ordersApi } from './api'
import { orderKeys } from './queries'

/**
 * A status change moves the row between filtered lists — "what needs packing"
 * loses it and "what is shipped" gains it — so the lists are invalidated rather
 * than patched.
 */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note?: string | null }) =>
      ordersApi.updateStatus(id, status, note),
    onSuccess: (order: Order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order)
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
    },
  })
}
