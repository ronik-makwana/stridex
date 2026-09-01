import { api, get, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  Customer,
  CustomerAddress,
  CustomerBasket,
  CustomerListQuery,
  CustomerSession,
  CustomerStatus,
  OrderRow,
} from '@/types/api'

export const customersApi = {
  list: async (params: CustomerListQuery) => {
    const response = await api.get<ApiListResponse<Customer>>('/customers', { params })
    return response.data
  },

  get: (id: string) => get<Customer>(`/customers/${id}`),

  orders: async (id: string, page = 1) => {
    const response = await api.get<ApiListResponse<OrderRow>>(`/customers/${id}/orders`, {
      params: { page, limit: 10 },
    })
    return response.data
  },

  addresses: (id: string) => get<CustomerAddress[]>(`/customers/${id}/addresses`),

  /** Cart and wishlist together — on a support call they are one question. */
  basket: (id: string) => get<CustomerBasket>(`/customers/${id}/basket`),

  sessions: (id: string) => get<CustomerSession[]>(`/customers/${id}/sessions`),

  setStatus: (id: string, status: CustomerStatus) =>
    patch<Customer>(`/customers/${id}/status`, { status }),

  revokeSessions: (id: string) => post<{ revoked: number }>(`/customers/${id}/sessions/revoke`),
}
