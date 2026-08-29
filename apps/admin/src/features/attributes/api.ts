import { api, del, get, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  Attribute,
  AttributeListQuery,
  AttributeValue,
} from '@/types/api'
import type { AttributeValues, AttributeValueValues } from './schemas'

export const attributesApi = {
  // The list needs `meta`, so it goes through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: AttributeListQuery) => {
    const response = await api.get<ApiListResponse<Attribute>>('/attributes', { params })
    return response.data
  },

  get: (id: string) => get<Attribute>(`/attributes/${id}`),

  create: (body: AttributeValues) => post<Attribute>('/attributes', body),

  update: (id: string, body: Partial<AttributeValues>) =>
    patch<Attribute>(`/attributes/${id}`, body),

  remove: (id: string) => del(`/attributes/${id}`),

  listValues: (id: string) => get<AttributeValue[]>(`/attributes/${id}/values`),

  createValue: (id: string, body: AttributeValueValues) =>
    post<AttributeValue>(`/attributes/${id}/values`, body),

  updateValue: (id: string, valueId: string, body: Partial<AttributeValueValues>) =>
    patch<AttributeValue>(`/attributes/${id}/values/${valueId}`, body),

  removeValue: (id: string, valueId: string) => del(`/attributes/${id}/values/${valueId}`),

  /** Answers with the reordered list, so the cache can be written directly. */
  reorderValues: (id: string, ids: string[]) =>
    patch<AttributeValue[]>(`/attributes/${id}/values/reorder`, { ids }),
}
