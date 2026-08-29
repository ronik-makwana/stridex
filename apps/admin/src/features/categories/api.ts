import { api, del, get, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  Category,
  CategoryListQuery,
  CategoryMove,
  EntityStatus,
} from '@/types/api'
import type { CategoryValues } from './schemas'

/** What to do with the children of a category being deleted. */
export type ChildAction = 'block' | 'reparent'

export const categoriesApi = {
  // The list needs `meta`, so it goes through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: CategoryListQuery) => {
    const response = await api.get<ApiListResponse<Category>>('/categories', { params })
    return response.data
  },

  /** Unpaginated and nested — the shape the tree page renders directly. */
  tree: () => get<Category[]>('/categories/tree'),

  get: (id: string) => get<Category>(`/categories/${id}`),

  create: (body: CategoryValues) => post<Category>('/categories', body),

  update: (id: string, body: Partial<CategoryValues>) =>
    patch<Category>(`/categories/${id}`, body),

  setStatus: (id: string, status: EntityStatus) =>
    patch<Category>(`/categories/${id}/status`, { status }),

  remove: (id: string, childAction: ChildAction = 'block') =>
    del(`/categories/${id}`, { params: { childAction } }),

  /** Answers with the settled tree, so the cache can be written directly. */
  reorder: (moves: CategoryMove[]) => patch<Category[]>('/categories/reorder', { moves }),
}
