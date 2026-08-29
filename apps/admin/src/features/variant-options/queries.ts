import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { VariantOptionListQuery } from '@/types/api'
import { variantOptionsApi } from './api'

export const variantOptionKeys = {
  all: ['variant-options'] as const,
  lists: () => [...variantOptionKeys.all, 'list'] as const,
  list: (query: VariantOptionListQuery) => [...variantOptionKeys.lists(), query] as const,
  detail: (id: string) => [...variantOptionKeys.all, 'detail', id] as const,
}

export function useVariantOptions(query: VariantOptionListQuery) {
  return useQuery({
    queryKey: variantOptionKeys.list(query),
    queryFn: () => variantOptionsApi.list(query),
    // Paging and filtering keep the previous page on screen instead of
    // flashing a skeleton over a table that is about to look almost the same.
    placeholderData: keepPreviousData,
  })
}

/**
 * One query for the whole detail page — the endpoint returns the option with
 * its values, so a separate values query would only add a second spinner and a
 * window where the header and the list disagree.
 */
export function useVariantOption(id: string | undefined) {
  return useQuery({
    queryKey: variantOptionKeys.detail(id!),
    queryFn: () => variantOptionsApi.get(id!),
    enabled: Boolean(id),
  })
}
