import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ProductListQuery } from '@/types/api'
import { productsApi } from './api'

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (query: ProductListQuery) => [...productKeys.lists(), query] as const,
  detail: (id: string) => [...productKeys.all, 'detail', id] as const,
  checklist: (id: string) => [...productKeys.all, 'checklist', id] as const,
}

export function useProducts(query: ProductListQuery) {
  return useQuery({
    queryKey: productKeys.list(query),
    queryFn: () => productsApi.list(query),
    // Paging and filtering keep the previous page on screen instead of flashing
    // a skeleton over a table that is about to look almost the same.
    placeholderData: keepPreviousData,
  })
}

/**
 * One query for the whole editor. The detail endpoint returns media,
 * attributes, options and variants together, so splitting it would only add
 * four spinners and a window where the panels disagree with each other.
 */
export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id!),
    queryFn: () => productsApi.get(id!),
    enabled: Boolean(id),
  })
}

/**
 * Fetched when the Publish popover opens, and never cached for long: the
 * checklist is about the product as it is right now, and a stale "ready" is
 * worse than a spinner.
 */
export function usePublishChecklist(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: productKeys.checklist(id!),
    queryFn: () => productsApi.publishChecklist(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 0,
  })
}
