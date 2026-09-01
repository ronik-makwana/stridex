import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { OrderListQuery } from '@/types/api'
import { ordersApi } from './api'

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (query: OrderListQuery) => [...orderKeys.lists(), query] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
}

export function useOrders(query: OrderListQuery) {
  return useQuery({
    queryKey: orderKeys.list(query),
    queryFn: () => ordersApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id!),
    queryFn: () => ordersApi.get(id!),
    enabled: Boolean(id),
  })
}
