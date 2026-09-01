import { api, get } from '@/lib/api-client'
import type { Order, OrderCard } from '@/types/api'

export const ordersApi = {
  /** Newest first. Nobody sorts their own order history, so there is no sort. */
  list: async (page = 1) => {
    const response = await api.get<{ data: OrderCard[]; meta: { page: number; totalPages: number; total: number } }>(
      '/orders',
      { params: { page, limit: 10 } },
    )
    return response.data
  },

  /** By the number on the email, not by an id the customer never sees. */
  get: (orderNumber: string) => get<Order>(`/orders/${orderNumber}`),
}
