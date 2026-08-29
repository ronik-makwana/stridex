import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { BrandListQuery } from '@/types/api'
import { brandsApi } from './api'

export const brandKeys = {
  all: ['brands'] as const,
  lists: () => [...brandKeys.all, 'list'] as const,
  list: (query: BrandListQuery) => [...brandKeys.lists(), query] as const,
  detail: (id: string) => [...brandKeys.all, 'detail', id] as const,
}

export function useBrands(query: BrandListQuery) {
  return useQuery({
    queryKey: brandKeys.list(query),
    queryFn: () => brandsApi.list(query),
    // Paging and filtering keep the previous page on screen instead of
    // flashing a skeleton over a table that is about to look almost the same.
    placeholderData: keepPreviousData,
  })
}

export function useBrand(id: string | undefined) {
  return useQuery({
    queryKey: brandKeys.detail(id!),
    queryFn: () => brandsApi.get(id!),
    enabled: Boolean(id),
  })
}
