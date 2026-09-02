import { api, del, get, post } from '@/lib/api-client'
import type { Order, OrderCard, RefundReason } from '@/types/api'

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

/**
 * The three writes a customer may make to their own order.
 *
 * All of them answer with the **whole order**, not with the thing they created.
 * After a cancellation every part of that page reads differently — the status,
 * the timeline, what may still be done — and returning the refund alone would
 * leave the client to patch its own copy together and get a detail wrong.
 */
export const orderActionsApi = {
  cancel: (orderNumber: string, body: { reason: RefundReason; comment: string | null }) =>
    post<Order>(`/orders/${orderNumber}/cancel`, body),

  requestReturn: (
    orderNumber: string,
    body: {
      items: { orderItemId: string; quantity: number }[]
      reason: RefundReason
      comment: string | null
    },
  ) => post<Order>(`/orders/${orderNumber}/returns`, body),

  /** Un-asks the question. Only possible while nobody has approved it. */
  withdrawReturn: (orderNumber: string, requestId: string) =>
    del<Order>(`/orders/${orderNumber}/returns/${requestId}`),
}
