import type { Payment, Prisma } from '@shoe/db'
import { money } from './money.js'

/**
 * What the browser is allowed to know about a payment attempt.
 *
 * `provider_response` never leaves the server: it is whatever the provider
 * said, kept verbatim for the 2am read, and it can carry anything from an
 * internal error string to a customer's card metadata.
 */
type PaymentWithClientPayload = Payment & {
  /** Only on the response to `POST /payments` — how to complete this attempt. */
  clientPayload?: Record<string, unknown>
}

export function serializeShopPayment(payment: PaymentWithClientPayload) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    amount: money(payment.amount as Prisma.Decimal),
    currency: payment.currency,
    /**
     * The provider's word on this attempt, and never the thing the UI decides
     * an order's fate from — that comes from the order, written by the webhook
     * (§12).
     */
    status: payment.status,
    method: payment.method,
    createdAt: payment.createdAt,
    ...(payment.clientPayload ? { clientPayload: payment.clientPayload } : {}),
  }
}

export type ShopPaymentPayload = ReturnType<typeof serializeShopPayment>
