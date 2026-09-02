/**
 * The six things a payment provider has to do, and the whole of what the rest
 * of the codebase knows about one.
 *
 * Everything above this interface — the payments service, the webhook handler,
 * the order write, the refund engine — is provider-agnostic on purpose.
 * Razorpay drops in behind it later by implementing these six methods, and
 * nothing else changes.
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

/** Money going back out. Minor units, like everything else that crosses here. */
export type RefundArgs = {
  /** The capture this takes money out of. A refund is always against a payment. */
  providerPaymentId: string
  amountInPaise: number
  /**
   * Ours, and required — unlike a payment's, which can be absent on rows the
   * webhook wrote. Every refund in this system is issued by our own code, so
   * there is always a key, and the provider is asked to honour it: a retried
   * call after a timeout must return the first refund rather than make a second.
   */
  idempotencyKey: string
  /** Free text for their dashboard. Never shown to a customer. */
  note?: string | null
}

/**
 * What the provider said when asked. `SUCCEEDED` here is *their* answer to the
 * call, not our record of it — the row still waits for the webhook, because a
 * synchronous 200 and a settled refund are not the same event (§8, §12).
 */
export type CreatedRefund = {
  providerRefundId: string
  status: RefundState
  raw: Record<string, unknown>
}

export type RefundState = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

/** Their own view of a refund, read back when the webhook never came (§9). */
export type ProviderRefundState = {
  providerRefundId: string
  status: RefundState
  amountInPaise: number
  raw: Record<string, unknown>
}

/** What a webhook body means, once it has been proven to have come from them. */
export type ParsedPaymentWebhook = {
  /**
   * Which half of the money this event is about. Payments and refunds arrive
   * at the same URL, with the same signature scheme, and land on two entirely
   * different tables — so the parser decides which, once, and the handler
   * switches on a discriminant rather than sniffing fields.
   */
  kind: 'payment'
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

/**
 * A refund settling, or not.
 *
 * Carries the refund's provider id rather than the payment's, because that is
 * what identifies the row: one payment can have several refunds, and matching
 * on the payment would settle the wrong one. The payment id rides along for
 * the log line and for the reconciliation that has only the payment to go on.
 */
export type ParsedRefundWebhook = {
  kind: 'refund'
  eventId: string
  providerRefundId: string
  providerPaymentId: string | null
  /** Only the two ends. A refund still in flight is not an event worth sending. */
  status: 'SUCCEEDED' | 'FAILED'
  amountInPaise: number
  failureReason?: string | null
  raw: Record<string, unknown>
}

export type ParsedWebhook = ParsedPaymentWebhook | ParsedRefundWebhook

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
   * Send money back. Returns as soon as the provider has accepted the
   * instruction — **not** when it has settled. Nothing in this codebase treats
   * a return from here as a completed refund; the webhook does that (§8, §12).
   */
  refundPayment(args: RefundArgs): Promise<CreatedRefund>

  /**
   * Read a refund back. The mirror of `getPayment`, and wanted for the same
   * reason at the same hour: a refund stuck PROCESSING is a customer waiting
   * for money with nothing in our records saying why.
   */
  getRefund(providerRefundId: string): Promise<ProviderRefundState | null>

  /**
   * Whether this body really came from the provider. Takes the raw bytes, never
   * the parsed object — re-serialising JSON changes it, and a signature over
   * re-serialised JSON verifies nothing.
   */
  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean

  parseWebhook(rawBody: Buffer | string): ParsedWebhook
}
