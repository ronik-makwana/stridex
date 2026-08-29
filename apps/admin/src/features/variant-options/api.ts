import { api, del, get, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  VariantOption,
  VariantOptionListQuery,
  VariantOptionValue,
} from '@/types/api'
import type { OptionValueValues, VariantOptionValues } from './schemas'

export const variantOptionsApi = {
  // The list needs `meta`, so it goes through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: VariantOptionListQuery) => {
    const response = await api.get<ApiListResponse<VariantOption>>('/variant-options', { params })
    return response.data
  },

  get: (id: string) => get<VariantOption>(`/variant-options/${id}`),

  create: (body: VariantOptionValues) => post<VariantOption>('/variant-options', body),

  update: (id: string, body: Partial<VariantOptionValues>) =>
    patch<VariantOption>(`/variant-options/${id}`, body),

  remove: (id: string) => del(`/variant-options/${id}`),

  listValues: (id: string) => get<VariantOptionValue[]>(`/variant-options/${id}/values`),

  createValue: (id: string, body: OptionValueValues) =>
    post<VariantOptionValue>(`/variant-options/${id}/values`, body),

  updateValue: (id: string, valueId: string, body: Partial<OptionValueValues>) =>
    patch<VariantOptionValue>(`/variant-options/${id}/values/${valueId}`, body),

  removeValue: (id: string, valueId: string) => del(`/variant-options/${id}/values/${valueId}`),

  /** Answers with the reordered list, so the cache can be written directly. */
  reorderValues: (id: string, ids: string[]) =>
    patch<VariantOptionValue[]>(`/variant-options/${id}/values/reorder`, { ids }),
}
