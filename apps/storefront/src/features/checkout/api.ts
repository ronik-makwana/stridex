import { api, del, get, post } from '@/lib/api-client'
import type { CheckoutSession, Payment } from '@/types/api'

/**
 * The checkout half of the storefront's API surface. Every one of these answers
 * with the whole re-quoted session, because a page that patched one field of a
 * summary would be a page whose total stops adding up.
 */
export const checkoutApi = {
  /** Creates a session from the cart: revalidates, holds stock, snapshots prices. */
  create: () => post<CheckoutSession>('/checkout', {}),

  /** Refresh, back button, second tab. Creates nothing. */
  get: (id: string) => get<CheckoutSession>(`/checkout/${id}`),

  /**
   * "Do I have one open?" — the cart's only way to know that a checkout exists
   * and that stock is being held for it. Null when there is none.
   */
  active: () => get<CheckoutSession | null>('/checkout/active'),

  setAddress: (id: string, shippingAddressId: string, billingAddressId?: string) =>
    post<CheckoutSession>(`/checkout/${id}/address`, { shippingAddressId, billingAddressId }),

  cancel: (id: string) => del(`/checkout/${id}`),

  /**
   * The key is generated once per attempt by the caller and reused across every
   * retry of that attempt — which is the whole of the guarantee (§7, §13).
   */
  pay: async (checkoutSessionId: string, idempotencyKey: string) => {
    const response = await api.post<{ data: Payment }>(
      '/payments',
      { checkoutSessionId },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    return response.data.data
  },

  payment: (id: string) => get<Payment>(`/payments/${id}`),

  /**
   * Development only. Stands in for the provider's hosted page: the API signs a
   * webhook and posts it to its own endpoint, so the real path runs.
   */
  mockComplete: (paymentId: string, outcome: 'success' | 'fail') =>
    post<unknown>(`/payments/${paymentId}/mock-complete`, { outcome }),
}
