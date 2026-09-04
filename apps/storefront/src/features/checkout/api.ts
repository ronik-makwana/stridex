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

  /**
   * A code, never a rate. The server answers with the whole re-quoted session,
   * because choosing express changed the total the Pay button is about to
   * charge.
   */
  setShippingMethod: (id: string, method: string) =>
    post<CheckoutSession>(`/checkout/${id}/shipping-method`, { method }),

  /**
   * A code, never an amount. The server answers with the whole re-quoted
   * session, because a discount changes what the Pay button is about to charge.
   */
  applyCoupon: (id: string, code: string) =>
    post<CheckoutSession>(`/checkout/${id}/coupons`, { code }),

  // `del` already unwraps the envelope, like every other helper here.
  removeCoupon: (id: string, couponId: string) =>
    del<CheckoutSession>(`/checkout/${id}/coupons/${couponId}`),

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
}
