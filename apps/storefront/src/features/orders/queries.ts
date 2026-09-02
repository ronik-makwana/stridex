import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import type { Order, RefundReason } from '@/types/api'
import { orderActionsApi, ordersApi } from './api'

export const orderKeys = {
  all: ['orders'] as const,
  list: (page: number) => [...orderKeys.all, 'list', page] as const,
  detail: (orderNumber: string) => [...orderKeys.all, 'detail', orderNumber] as const,
}

export function useOrders(page = 1) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: orderKeys.list(page),
    queryFn: () => ordersApi.list(page),
    enabled: isAuthenticated,
    placeholderData: keepPreviousData,
  })
}

/**
 * Also what the confirmation page polls while the webhook lands: the order
 * appears the moment the provider confirms, and until then this 404s — which
 * is the honest intermediate state, not a fake success (§10, §12).
 */
export function useOrder(orderNumber: string | undefined, options: { poll?: boolean } = {}) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: orderKeys.detail(orderNumber ?? ''),
    queryFn: () => ordersApi.get(orderNumber!),
    enabled: isAuthenticated && Boolean(orderNumber),
    refetchInterval: options.poll ? 2_000 : false,
    retry: options.poll ? 5 : false,
  })
}

/**
 * Every write here invalidates both the detail and the list rather than
 * patching the cache.
 *
 * The server recomputes `cancellable`, `returnable`, the timeline, the refund
 * lines and each item's `returnableQuantity` from the rows it just wrote —
 * five derived answers — and hand-reconciling them in the browser is how a page
 * ends up offering a return for a pair that has already gone back.
 */
function useInvalidateOrder(orderNumber: string) {
  const queryClient = useQueryClient()
  return (order: Order) => {
    queryClient.setQueryData(orderKeys.detail(orderNumber), order)
    return queryClient.invalidateQueries({ queryKey: orderKeys.all })
  }
}

export function useCancelOrder(orderNumber: string) {
  const settle = useInvalidateOrder(orderNumber)
  return useMutation({
    mutationFn: (body: { reason: RefundReason; comment: string | null }) =>
      orderActionsApi.cancel(orderNumber, body),
    onSuccess: settle,
  })
}

export function useRequestReturn(orderNumber: string) {
  const settle = useInvalidateOrder(orderNumber)
  return useMutation({
    mutationFn: (body: {
      items: { orderItemId: string; quantity: number }[]
      reason: RefundReason
      comment: string | null
    }) => orderActionsApi.requestReturn(orderNumber, body),
    onSuccess: settle,
  })
}

export function useWithdrawReturn(orderNumber: string) {
  const settle = useInvalidateOrder(orderNumber)
  return useMutation({
    mutationFn: (requestId: string) => orderActionsApi.withdrawReturn(orderNumber, requestId),
    onSuccess: settle,
  })
}
