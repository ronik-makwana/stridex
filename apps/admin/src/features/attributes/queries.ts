import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AttributeListQuery } from '@/types/api'
import { attributesApi } from './api'

export const attributeKeys = {
  all: ['attributes'] as const,
  lists: () => [...attributeKeys.all, 'list'] as const,
  list: (query: AttributeListQuery) => [...attributeKeys.lists(), query] as const,
  detail: (id: string) => [...attributeKeys.all, 'detail', id] as const,
}

export function useAttributes(query: AttributeListQuery) {
  return useQuery({
    queryKey: attributeKeys.list(query),
    queryFn: () => attributesApi.list(query),
    // Paging and filtering keep the previous page on screen instead of
    // flashing a skeleton over a table that is about to look almost the same.
    placeholderData: keepPreviousData,
  })
}

/**
 * One query for the whole detail page — the endpoint returns the attribute with
 * its values, so a separate values query would only add a second spinner and a
 * window where the header and the list disagree.
 */
export function useAttribute(id: string | undefined) {
  return useQuery({
    queryKey: attributeKeys.detail(id!),
    queryFn: () => attributesApi.get(id!),
    enabled: Boolean(id),
  })
}
