import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { DiscountListQuery } from '@/types/api'
import { discountsApi } from './api'

export const discountKeys = {
  all: ['discounts'] as const,
  lists: () => [...discountKeys.all, 'list'] as const,
  list: (query: DiscountListQuery) => [...discountKeys.lists(), query] as const,
  detail: (id: string) => [...discountKeys.all, 'detail', id] as const,
}

export function useDiscounts(query: DiscountListQuery) {
  return useQuery({
    queryKey: discountKeys.list(query),
    queryFn: () => discountsApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useDiscount(id: string | undefined) {
  return useQuery({
    queryKey: discountKeys.detail(id!),
    queryFn: () => discountsApi.get(id!),
    enabled: Boolean(id),
  })
}
