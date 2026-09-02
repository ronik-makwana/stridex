import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReturnListQuery } from '@/types/api'
import { returnsApi } from './api'

export const returnKeys = {
  all: ['returns'] as const,
  lists: () => [...returnKeys.all, 'list'] as const,
  list: (query: ReturnListQuery) => [...returnKeys.lists(), query] as const,
  detail: (id: string) => [...returnKeys.all, 'detail', id] as const,
}

export function useReturns(query: ReturnListQuery) {
  return useQuery({
    queryKey: returnKeys.list(query),
    queryFn: () => returnsApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useReturn(id: string | undefined) {
  return useQuery({
    queryKey: returnKeys.detail(id!),
    queryFn: () => returnsApi.get(id!),
    enabled: Boolean(id),
  })
}
