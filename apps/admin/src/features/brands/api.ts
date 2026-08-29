import { api, del, get, patch, post } from '@/lib/api-client'
import type { ApiListResponse, Brand, BrandListQuery, EntityStatus } from '@/types/api'
import type { BrandValues } from './schemas'

export const brandsApi = {
  // The list needs `meta`, so it goes through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: BrandListQuery) => {
    const response = await api.get<ApiListResponse<Brand>>('/brands', { params })
    return response.data
  },

  get: (id: string) => get<Brand>(`/brands/${id}`),

  create: (body: BrandValues) => post<Brand>('/brands', body),

  update: (id: string, body: Partial<BrandValues>) => patch<Brand>(`/brands/${id}`, body),

  setStatus: (id: string, status: EntityStatus) =>
    patch<Brand>(`/brands/${id}/status`, { status }),

  remove: (id: string) => del(`/brands/${id}`),
}
