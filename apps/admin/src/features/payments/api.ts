import { api, get } from '@/lib/api-client'
import type { ApiListResponse, Payment, PaymentListQuery, PaymentRow } from '@/types/api'

/** Read-only. Every write to a payment arrives through a provider webhook. */
export const paymentsApi = {
  list: async (params: PaymentListQuery) => {
    const response = await api.get<ApiListResponse<PaymentRow>>('/payments', { params })
    return response.data
  },
  get: (id: string) => get<Payment>(`/payments/${id}`),
}
