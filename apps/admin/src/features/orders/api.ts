import { api, get, patch } from '@/lib/api-client'
import type { ApiListResponse, Order, OrderHistoryEntry, OrderListQuery, OrderRow } from '@/types/api'

export const ordersApi = {
  list: async (params: OrderListQuery) => {
    const response = await api.get<ApiListResponse<OrderRow>>('/orders', { params })
    return response.data
  },

  get: (id: string) => get<Order>(`/orders/${id}`),

  history: (id: string) => get<OrderHistoryEntry[]>(`/orders/${id}/history`),

  /**
   * The only write in this module. Answers with the whole order, because the
   * status change also produced a history row the screen has to render.
   */
  updateStatus: (id: string, status: string, note?: string | null) =>
    patch<Order>(`/orders/${id}/status`, { status, note: note ?? null }),
}
