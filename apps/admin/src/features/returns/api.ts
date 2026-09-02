import { api, get, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  Order,
  RefundReason,
  ReturnListQuery,
  ReturnRequest,
  ReturnRow,
} from '@/types/api'

/**
 * The returns queue. No POST of a request and no DELETE: a return is raised by
 * the customer, and a withdrawn or rejected one is still something that
 * happened — the queue is the record of it.
 */
export const returnsApi = {
  list: async (params: ReturnListQuery) => {
    const response = await api.get<ApiListResponse<ReturnRow>>('/returns', { params })
    return response.data
  },

  get: (id: string) => get<ReturnRequest>(`/returns/${id}`),

  approve: (id: string, note: string | null) =>
    post<ReturnRequest>(`/returns/${id}/approve`, { note }),

  /** The note is shown to the customer, so it is required by the schema. */
  reject: (id: string, note: string) => post<ReturnRequest>(`/returns/${id}/reject`, { note }),

  /**
   * The parcel arrived. Stock moves and money leaves in one transaction, which
   * is why this takes what *actually* turned up rather than what was asked for.
   */
  receive: (
    id: string,
    body: {
      items: { requestItemId: string; restockQuantity: number; unsellableQuantity: number }[]
      note: string | null
    },
  ) => post<ReturnRequest>(`/returns/${id}/receive`, body),

  /**
   * A refund against an order rather than a return — goodwill, a late delivery.
   * Lives here because it is the same money, but it opens no request and moves
   * no stock. Answers with the whole order.
   */
  refundOrder: (orderId: string, body: { amount: string; reason: RefundReason; note: string }) =>
    post<Order>(`/orders/${orderId}/refunds`, body),
}
