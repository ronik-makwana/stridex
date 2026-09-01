import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaymentListQuery } from '@/types/api'
import { paymentsApi } from './api'

export const paymentKeys = {
  all: ['payments'] as const,
  lists: () => [...paymentKeys.all, 'list'] as const,
  list: (query: PaymentListQuery) => [...paymentKeys.lists(), query] as const,
  detail: (id: string) => [...paymentKeys.all, 'detail', id] as const,
}

export function usePayments(query: PaymentListQuery) {
  return useQuery({
    queryKey: paymentKeys.list(query),
    queryFn: () => paymentsApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.detail(id!),
    queryFn: () => paymentsApi.get(id!),
    enabled: Boolean(id),
  })
}
