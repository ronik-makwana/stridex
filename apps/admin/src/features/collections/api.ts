import { api, del, get, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  Collection,
  CollectionListQuery,
  EntityStatus,
  MatchType,
  Product,
  RuleDraft,
  RuleFieldDefinition,
  RulePreview,
} from '@/types/api'
import type { CollectionValues } from './schemas'

export const collectionsApi = {
  // Lists need `meta`, so they go through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: CollectionListQuery) => {
    const response = await api.get<ApiListResponse<Collection>>('/collections', { params })
    return response.data
  },

  get: (id: string) => get<Collection>(`/collections/${id}`),

  create: (body: CollectionValues) => post<Collection>('/collections', body),

  update: (id: string, body: Partial<CollectionValues>) =>
    patch<Collection>(`/collections/${id}`, body),

  setStatus: (id: string, status: EntityStatus) =>
    patch<Collection>(`/collections/${id}/status`, { status }),

  remove: (id: string) => del(`/collections/${id}`),

  /** The field list the rule builder draws itself from. */
  ruleFields: () => get<RuleFieldDefinition[]>('/collections/rule-fields'),

  /** Unsaved rules in, count and sample out. Nothing is persisted. */
  preview: (body: { matchType: MatchType; rules: RuleDraft[]; limit?: number }) =>
    post<RulePreview>('/collections/preview', body),

  products: async (id: string, params: { page?: number; limit?: number }) => {
    const response = await api.get<ApiListResponse<Product>>(`/collections/${id}/products`, {
      params,
    })
    return response.data
  },

  addProducts: (id: string, productIds: string[]) =>
    post<{ added: number }>(`/collections/${id}/products`, { productIds }),

  removeProduct: (id: string, productId: string) =>
    del(`/collections/${id}/products/${productId}`),

  reorderProducts: (id: string, ids: string[]) =>
    patch<void>(`/collections/${id}/products/reorder`, { ids }),
}
