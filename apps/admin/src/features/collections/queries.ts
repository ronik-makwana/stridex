import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { CollectionListQuery } from '@/types/api'
import { collectionsApi } from './api'

export const collectionKeys = {
  all: ['collections'] as const,
  lists: () => [...collectionKeys.all, 'list'] as const,
  list: (query: CollectionListQuery) => [...collectionKeys.lists(), query] as const,
  detail: (id: string) => [...collectionKeys.all, 'detail', id] as const,
  products: (id: string, page: number) => [...collectionKeys.all, 'products', id, page] as const,
  ruleFields: () => [...collectionKeys.all, 'rule-fields'] as const,
}

export function useCollections(query: CollectionListQuery) {
  return useQuery({
    queryKey: collectionKeys.list(query),
    queryFn: () => collectionsApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: collectionKeys.detail(id!),
    queryFn: () => collectionsApi.get(id!),
    enabled: Boolean(id),
  })
}

/**
 * Manual and dynamic both answer here — the screen showing the products should
 * not have to know which kind of collection it is looking at.
 */
export function useCollectionProducts(id: string | undefined, page: number, limit = 25) {
  return useQuery({
    queryKey: collectionKeys.products(id!, page),
    queryFn: () => collectionsApi.products(id!, { page, limit }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  })
}

/** Changes only when the catalogue's attributes do, so it is cached hard. */
export function useRuleFields() {
  return useQuery({
    queryKey: collectionKeys.ruleFields(),
    queryFn: () => collectionsApi.ruleFields(),
    staleTime: 30 * 60_000,
  })
}
