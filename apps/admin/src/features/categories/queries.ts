import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { CategoryListQuery } from '@/types/api'
import { categoriesApi } from './api'

export const categoryKeys = {
  all: ['categories'] as const,
  tree: () => [...categoryKeys.all, 'tree'] as const,
  lists: () => [...categoryKeys.all, 'list'] as const,
  list: (query: CategoryListQuery) => [...categoryKeys.lists(), query] as const,
  detail: (id: string) => [...categoryKeys.all, 'detail', id] as const,
}

/**
 * One query for the whole page. The tree is unpaginated by design, so there is
 * nothing to page through and no second spinner for the counts — searching
 * filters what is already loaded rather than round-tripping per keystroke.
 */
export function useCategoryTree() {
  return useQuery({
    queryKey: categoryKeys.tree(),
    queryFn: () => categoriesApi.tree(),
  })
}

export function useCategories(query: CategoryListQuery) {
  return useQuery({
    queryKey: categoryKeys.list(query),
    queryFn: () => categoriesApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useCategory(id: string | undefined) {
  return useQuery({
    queryKey: categoryKeys.detail(id!),
    queryFn: () => categoriesApi.get(id!),
    enabled: Boolean(id),
  })
}
