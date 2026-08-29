import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import type { Category, CategoryMove, EntityStatus } from '@/types/api'
import { categoriesApi, type ChildAction } from './api'
import { categoryKeys } from './queries'
import type { CategoryValues } from './schemas'

/**
 * Every write can move a node between branches, change a rolled-up count on
 * each of its ancestors, or renumber a sibling row, so invalidating the whole
 * `categories` subtree is the only correct move — a targeted patch would leave
 * the parent's total stale.
 */
function useInvalidateCategories() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: categoryKeys.all })
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: (values: CategoryValues) => categoriesApi.create(values),
    onSuccess: (category) => {
      void invalidate()
      toast.success(`${category.name} created`)
    },
  })
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<CategoryValues> }) =>
      categoriesApi.update(id, values),
    onSuccess: (category) => {
      queryClient.setQueryData(categoryKeys.detail(category.id), category)
      void queryClient.invalidateQueries({ queryKey: categoryKeys.all })
      toast.success(`${category.name} updated`)
    },
  })
}

export function useSetCategoryStatus() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntityStatus }) =>
      categoriesApi.setStatus(id, status),
    onSuccess: (category: Category) => {
      void invalidate()
      toast.success(`${category.name} is now ${category.status.toLowerCase()}`)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not change the status')
    },
  })
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: ({ id, childAction }: { id: string; childAction?: ChildAction }) =>
      categoriesApi.remove(id, childAction),
    onSuccess: () => void invalidate(),
    // No toast here: a blocked delete is a 422 the dialog turns into an
    // explanation with a way forward, which a toast would talk over.
  })
}

export function useReorderCategories() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (moves: CategoryMove[]) => categoriesApi.reorder(moves),
    onSuccess: (tree: Category[]) => {
      // The response is the settled tree. Writing it straight into the cache
      // keeps the page still — an invalidate would refetch and re-animate a
      // tree the operator just finished dragging. The flat lists still go, as
      // a reparent changes the paths they render.
      queryClient.setQueryData(categoryKeys.tree(), tree)
      void queryClient.invalidateQueries({ queryKey: categoryKeys.lists() })
    },
  })
}
