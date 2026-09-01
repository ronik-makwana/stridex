import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { CustomerListQuery } from '@/types/api'
import { customersApi } from './api'

export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (query: CustomerListQuery) => [...customerKeys.lists(), query] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
  tab: (id: string, tab: string) => [...customerKeys.all, 'detail', id, tab] as const,
}

export function useCustomers(query: CustomerListQuery) {
  return useQuery({
    queryKey: customerKeys.list(query),
    queryFn: () => customersApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.detail(id!),
    queryFn: () => customersApi.get(id!),
    enabled: Boolean(id),
  })
}

/** One hook per tab, so opening a customer does not fetch five panels nobody looks at. */
export function useCustomerOrders(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.tab(id!, 'orders'),
    queryFn: () => customersApi.orders(id!),
    enabled: Boolean(id) && enabled,
  })
}

export function useCustomerAddresses(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.tab(id!, 'addresses'),
    queryFn: () => customersApi.addresses(id!),
    enabled: Boolean(id) && enabled,
  })
}

export function useCustomerBasket(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.tab(id!, 'basket'),
    queryFn: () => customersApi.basket(id!),
    enabled: Boolean(id) && enabled,
  })
}

export function useCustomerSessions(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.tab(id!, 'sessions'),
    queryFn: () => customersApi.sessions(id!),
    enabled: Boolean(id) && enabled,
  })
}
