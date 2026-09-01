import { api, del, get, patch, post, put } from '@/lib/api-client'
import type {
  ApiListResponse,
  Discount,
  DiscountAppliesTo,
  DiscountEligibility,
  DiscountKind,
  DiscountListQuery,
  DiscountMinRequirement,
  DiscountRow,
  DiscountStateAction,
  DiscountValueType,
} from '@/types/api'

/**
 * What the form sends. Ids rather than rows — the server checks that each one
 * still exists before it writes anything, so a picker left open while somebody
 * else deleted a product fails on the form rather than at checkout.
 */
export type DiscountValues = {
  code: string
  description?: string | null
  kind: DiscountKind
  type: DiscountValueType
  value: number
  maxDiscountAmount?: number | null
  appliesTo?: DiscountAppliesTo | null
  productIds: string[]
  categoryIds: string[]
  collectionIds: string[]
  eligibility: DiscountEligibility
  customerIds: string[]
  minRequirement: DiscountMinRequirement
  minCartValue?: number | null
  minQuantity?: number | null
  maxShippingAmount?: number | null
  usageLimit?: number | null
  perUserLimit?: number | null
  combinesWithProduct: boolean
  combinesWithOrder: boolean
  combinesWithShipping: boolean
  startsAt: string
  endsAt?: string | null
}

export const discountsApi = {
  list: async (params: DiscountListQuery) => {
    const response = await api.get<ApiListResponse<DiscountRow>>('/discounts', { params })
    return response.data
  },
  get: (id: string) => get<Discount>(`/discounts/${id}`),
  create: (body: DiscountValues) => post<Discount>('/discounts', body),
  /** A full replace: the relations make a partial update ambiguous. */
  update: (id: string, body: DiscountValues) => put<Discount>(`/discounts/${id}`, body),
  /** Deactivate ends it now; activate clears the end date. The server dates it. */
  setState: (id: string, action: DiscountStateAction) =>
    patch<Discount>(`/discounts/${id}/state`, { action }),
  remove: (id: string) => del(`/discounts/${id}`),
}
