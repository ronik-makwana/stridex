import { api, get, patch, post } from '@/lib/api-client'
import type {
  AdjustReason,
  AdjustStockInput,
  ApiListResponse,
  InventoryListQuery,
  InventoryRow,
  InventoryTransaction,
  RestockInput,
  TransactionListQuery,
} from '@/types/api'

export const inventoryApi = {
  // Lists need `meta`, so they go through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: InventoryListQuery) => {
    const response = await api.get<ApiListResponse<InventoryRow>>('/inventory', { params })
    return response.data
  },

  lowStock: async (params: InventoryListQuery) => {
    const response = await api.get<ApiListResponse<InventoryRow>>('/inventory/low-stock', { params })
    return response.data
  },

  get: (variantId: string) => get<InventoryRow>(`/inventory/${variantId}`),

  transactions: async (params: TransactionListQuery) => {
    const response = await api.get<ApiListResponse<InventoryTransaction>>(
      '/inventory/transactions',
      { params },
    )
    return response.data
  },

  variantTransactions: async (variantId: string, params: TransactionListQuery) => {
    const response = await api.get<ApiListResponse<InventoryTransaction>>(
      `/inventory/${variantId}/transactions`,
      { params },
    )
    return response.data
  },

  /** Served rather than hard-coded: the reasons map onto ledger types. */
  reasons: () => get<AdjustReason[]>('/inventory/reasons'),

  adjust: (variantId: string, body: AdjustStockInput) =>
    post<InventoryRow>(`/inventory/${variantId}/adjust`, body),

  restock: (variantId: string, body: RestockInput) =>
    post<InventoryRow>(`/inventory/${variantId}/restock`, body),

  setThreshold: (variantId: string, lowStockThreshold: number) =>
    patch<InventoryRow>(`/inventory/${variantId}/threshold`, { lowStockThreshold }),
}
