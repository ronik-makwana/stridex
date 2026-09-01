/**
 * The four things a payment provider has to do, and the whole of what the rest
 * of the codebase knows about one.
 *
 * Everything above this interface — the payments service, the webhook handler,
 * the order write — is provider-agnostic on purpose. Razorpay drops in behind
 * it later by implementing these four methods, and nothing else changes.
 */

export type CreatePaymentArgs = {
  /** Minor units. Money never crosses this boundary as a float. */
  amountInPaise: number
  currency: string
  /** Ours, for reconciliation from the provider's dashboard. */
  reference: string
  customerEmail?: string | null
}

export type CreatedPayment = {
  /** The provider's id for this attempt. Unique with `provider` in `payments`. */
  providerPaymentId: string
  /** What the browser needs to complete it. Shape is the provider's business. */
  clientPayload: Record<string, unknown>
}

/** The provider's own view of a payment, read back for reconciliation (§10). */
export type ProviderPaymentState = {
  providerPaymentId: string
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED'
  amountInPaise: number
  raw: Record<string, unknown>
}

/** What a webhook body means, once it has been proven to have come from them. */
export type ParsedWebhook = {
  /** Provider's event id. The idempotency key for delivery, not for payment. */
  eventId: string
  providerPaymentId: string
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED'
  amountInPaise: number
  /** Ours, echoed back — the link from their event to our session. */
  reference: string | null
  failureReason?: string | null
  raw: Record<string, unknown>
}

export interface PaymentProvider {
  readonly name: string

  createPayment(args: CreatePaymentArgs): Promise<CreatedPayment>

  /**
   * Read the provider's own record. Exists for reconciliation and nothing else,
   * which is why it is easy to forget until 2am on the day a webhook was never
   * delivered and an order is stuck in PAYMENT_PENDING (§10).
   */
  getPayment(providerPaymentId: string): Promise<ProviderPaymentState | null>

  /**
   * Whether this body really came from the provider. Takes the raw bytes, never
   * the parsed object — re-serialising JSON changes it, and a signature over
   * re-serialised JSON verifies nothing.
   */
  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean

  parseWebhook(rawBody: Buffer | string): ParsedWebhook
}
