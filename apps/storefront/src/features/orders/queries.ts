import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { ordersApi } from './api'

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
