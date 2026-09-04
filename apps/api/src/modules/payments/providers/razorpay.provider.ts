import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../../../config/env.js'
import { AppError, badRequest } from '../../../lib/errors.js'
import { logger } from '../../../lib/logger.js'
import type {
  CreatePaymentArgs,
  CreatedPayment,
  CreatedRefund,
  ParsedWebhook,
  PaymentProvider,
  ProviderPaymentState,
  ProviderRefundState,
  RefundArgs,
  RefundState,
} from './provider.types.js'

/**
 * Razorpay, behind the six methods in `provider.types.ts`.
 *
 * ─── the one thing that is not a straight mapping ──────────────────────────
 *
 * `providerPaymentId` here is a Razorpay **order** id (`order_…`), not a
 * payment id (`pay_…`).
 *
 * It has to be. `payments.provider_payment_id` is written when the attempt is
 * created — before a browser has opened the modal — and at that moment a
 * `pay_…` does not exist yet: Razorpay mints one per *attempt*, and a customer
 * who fails on a card and retries on UPI produces two against one order. The
 * order id is the only handle that exists at create time, survives retries, and
 * is unique per checkout session, which is exactly what the unique index on
 * `(provider, provider_payment_id)` needs.
 *
 * So this file translates in both directions: webhooks arrive carrying a
 * `pay_…` and are reported upward under their `order_id`, and refunds — which
 * Razorpay will only take against a `pay_…` — resolve the payment id back out
 * of the order before calling. The real `pay_…` is never lost; it is in
 * `providerResponse` on every captured row, and in the ledger.
 *
 * Nothing above this file knows any of that, which is the point.
 */

const API = 'https://api.razorpay.com/v1'

/** Razorpay speaks paise natively, so amounts cross this boundary unchanged. */

// ─── http ────────────────────────────────────────────────────────────────────

function authHeader(): string {
  const token = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')
  return `Basic ${token}`
}

type RazorpayError = { error?: { code?: string; description?: string; reason?: string } }

/**
 * One call to Razorpay.
 *
 * Their errors come back as `{ error: { code, description } }` with a 4xx, and
 * the description is the only part worth reading at 2am — so it is lifted into
 * the thrown error rather than left inside a body nobody logs. 502 upward,
 * because a failure here is an upstream failure and not the customer's fault:
 * the checkout shows "we could not reach the payment provider", which is true,
 * instead of a validation message about a request that was fine.
 */
async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // A payment API that has not answered in 20 seconds is not going to.
      // Without this the request inherits Node's default of never timing out,
      // and a hung connection holds the checkout open until the browser gives
      // up — with a payment that may or may not exist at the other end.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    logger.error({ err: error, path }, 'Razorpay was unreachable')
    throw new AppError(502, 'PAYMENT_PROVIDER_UNREACHABLE', 'Could not reach the payment provider', {
      reason: 'Try again in a moment.',
    })
  }

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Falls through to the status check below: a non-JSON 200 from a JSON API
    // is a failure too, it just has no description to quote.
  }

  if (!response.ok) {
    const description = (parsed as RazorpayError | null)?.error?.description
    logger.error(
      { path, status: response.status, body: parsed ?? text.slice(0, 500) },
      'Razorpay refused a request',
    )
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', description ?? 'The payment provider refused that request', {
      reason: 'Try again in a moment.',
    })
  }

  return parsed as T
}

// ─── their shapes, only as far as we read them ───────────────────────────────

type RzpOrder = { id: string; amount: number; currency: string; status: string; receipt?: string | null }

type RzpPayment = {
  id: string
  order_id: string | null
  /** Paise. */
  amount: number
  /** `created` | `authorized` | `captured` | `refunded` | `failed` */
  status: string
  method?: string | null
  error_description?: string | null
  error_reason?: string | null
  notes?: Record<string, unknown>
}

type RzpRefund = {
  id: string
  payment_id: string
  amount: number
  /** `pending` | `processed` | `failed` */
  status: string
  receipt?: string | null
  notes?: Record<string, unknown>
}

type RzpCollection<T> = { count: number; items: T[] }

/**
 * Ten digits, or nothing.
 *
 * Anything else is worse than sending no prefill at all: the sheet rejects it,
 * and a rejected prefill is a field the customer has to find and clear before
 * they can retype what we already had.
 */
function normaliseIndianMobile(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const local = digits.length > 10 ? digits.slice(-10) : digits
  return local.length === 10 ? local : null
}

const ORDER_PREFIX = 'order_'
const REFUND_PREFIX = 'rfnd_'

/**
 * Their payment status, in the four words this codebase uses.
 *
 * `refunded` maps to CAPTURED deliberately: a refunded payment is one that was
 * captured and then partly or wholly sent back, and the refund rows are what
 * say so. Reporting it as anything else would make reconciliation "fix" a
 * payment that is already correct.
 */
function paymentStatus(status: string): ProviderPaymentState['status'] {
  switch (status) {
    case 'captured':
    case 'refunded':
      return 'CAPTURED'
    case 'authorized':
      return 'AUTHORIZED'
    case 'failed':
      return 'FAILED'
    // `created` — the customer opened the modal and has not finished.
    default:
      return 'PENDING'
  }
}

function refundStatus(status: string): RefundState {
  switch (status) {
    case 'processed':
      return 'SUCCEEDED'
    case 'failed':
      return 'FAILED'
    // `pending` — accepted, money not moved yet.
    default:
      return 'PROCESSING'
  }
}

/**
 * The payment that matters, out of every attempt made against one order.
 *
 * Ordered rather than "the first one": a customer who fails on a card and then
 * pays by UPI leaves a failed attempt sitting next to a captured one, and
 * reading the wrong one would report a paid order as declined — or refund
 * against an id that never took any money.
 */
const ATTEMPT_RANK: Record<string, number> = { captured: 4, refunded: 4, authorized: 3, created: 2, failed: 1 }

function bestAttempt(items: RzpPayment[]): RzpPayment | null {
  return (
    [...items].sort((a, b) => (ATTEMPT_RANK[b.status] ?? 0) - (ATTEMPT_RANK[a.status] ?? 0))[0] ?? null
  )
}

async function paymentsForOrder(orderId: string): Promise<RzpPayment[]> {
  const collection = await call<RzpCollection<RzpPayment>>('GET', `/orders/${orderId}/payments`)
  return collection?.items ?? []
}

/**
 * An `order_…` from us, a `pay_…` for them.
 *
 * Refunds are the only thing that needs this. It costs a round trip, and the
 * alternative — trusting the `pay_…` cached in `provider_response` — is worse:
 * that column holds whatever the last webhook said, and a refund issued against
 * a stale attempt id fails at the bank rather than in our logs.
 */
async function capturedPaymentId(providerPaymentId: string): Promise<string> {
  if (!providerPaymentId.startsWith(ORDER_PREFIX)) {
    // Already a `pay_…`. Reconciliation on a row written before this file
    // existed, or a hand-fixed one; either way it is directly refundable.
    return providerPaymentId
  }

  const attempt = bestAttempt(await paymentsForOrder(providerPaymentId))
  if (!attempt || paymentStatus(attempt.status) !== 'CAPTURED') {
    // Refusing beats guessing. A refund against an uncaptured attempt is
    // rejected by Razorpay anyway, and this says why in our own words.
    throw badRequest('That Razorpay order has no captured payment to refund')
  }
  return attempt.id
}

// ─── signatures ──────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 hex over the raw bytes, keyed with the **webhook** secret — not
 * the API key secret, which is a different string and a 401 that looks like an
 * attack when confused.
 */
export function signRazorpayWebhook(rawBody: string): string {
  return createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

// ─── the provider ────────────────────────────────────────────────────────────

export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',

  /**
   * An order, which is Razorpay's word for "a thing a customer may now pay
   * for". No money moves here and none is authorised; this only mints the id
   * the checkout script needs.
   *
   * `receipt` carries our checkout session id, so a row in their dashboard can
   * be traced back to ours without a database. It is capped at 40 characters
   * and a uuid is 36, which is why the reference goes in whole rather than
   * prefixed with something friendly.
   */
  async createPayment(args: CreatePaymentArgs): Promise<CreatedPayment> {
    const order = await call<RzpOrder>('POST', '/orders', {
      amount: args.amountInPaise,
      currency: args.currency,
      receipt: args.reference.slice(0, 40),
      // Echoed back on every payment event, which is what lets a webhook for an
      // order we somehow lost still name the session it belonged to.
      notes: { reference: args.reference },
    })

    return {
      providerPaymentId: order.id,
      /**
       * Exactly what `Razorpay(options)` wants in the browser, and nothing
       * more. The key id is public by design — it identifies the merchant to
       * their script. The key *secret* and the webhook secret are not here and
       * must never be.
       */
      clientPayload: {
        provider: 'razorpay',
        key: env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        name: env.RAZORPAY_DISPLAY_NAME,
        /**
         * Both fields, because Razorpay gates its payment-method list behind a
         * contact number: sending only the email leaves the customer typing a
         * phone into somebody else's form mid-checkout.
         *
         * Their sheet wants ten digits — a stored `+91 98765 43210` is the same
         * number and it rejects it, so the punctuation comes off here and the
         * country code with it.
         */
        prefill: {
          email: args.customerEmail ?? undefined,
          contact: normaliseIndianMobile(args.customerPhone) ?? undefined,
        },
      },
    }
  },

  /**
   * Their record, read back when no webhook came (§10).
   *
   * Their ledger is authoritative, so this returns the truth rather than a
   * guess — which is what lets reconciliation genuinely rescue an order stuck
   * in PAYMENT_PENDING behind a webhook that was never delivered.
   */
  async getPayment(providerPaymentId: string): Promise<ProviderPaymentState | null> {
    if (providerPaymentId.startsWith(ORDER_PREFIX)) {
      const attempt = bestAttempt(await paymentsForOrder(providerPaymentId))
      // No attempt at all: the modal was opened and abandoned. Not an error,
      // and not a payment either — PENDING is the honest answer.
      if (!attempt) {
        return {
          providerPaymentId,
          status: 'PENDING',
          amountInPaise: 0,
          raw: { note: 'No payment attempt has been made against this order yet' },
        }
      }
      return {
        providerPaymentId,
        status: paymentStatus(attempt.status),
        amountInPaise: attempt.amount,
        raw: attempt as unknown as Record<string, unknown>,
      }
    }

    const payment = await call<RzpPayment>('GET', `/payments/${providerPaymentId}`)
    if (!payment) return null
    return {
      providerPaymentId,
      status: paymentStatus(payment.status),
      amountInPaise: payment.amount,
      raw: payment as unknown as Record<string, unknown>,
    }
  },

  /**
   * Money back out.
   *
   * Razorpay has no idempotency header on this endpoint, and the interface
   * above promises one: a retried call after a timeout must return the first
   * refund rather than issue a second. So it is built here, out of the parts
   * Razorpay does give — `receipt` is stored on the refund and readable back,
   * so the key goes there and every call looks first.
   *
   * That leaves one genuine race, and it is worth naming rather than hiding:
   * two *simultaneous* retries can both read an empty list and both create.
   * Our own `refunds.idempotency_key` unique index is what stops that reaching
   * this method twice — this check is for the sequential case, which is the one
   * that actually happens (a timeout, then a retry seconds later).
   */
  async refundPayment(args: RefundArgs): Promise<CreatedRefund> {
    const payId = await capturedPaymentId(args.providerPaymentId)

    const existing = await call<RzpCollection<RzpRefund>>('GET', `/payments/${payId}/refunds?count=100`)
    const already = (existing?.items ?? []).find((refund) => refund.receipt === args.idempotencyKey)
    if (already) {
      logger.info(
        { paymentId: payId, refundId: already.id, key: args.idempotencyKey },
        'Razorpay already has a refund for that key — returning it rather than issuing another',
      )
      return {
        providerRefundId: already.id,
        status: refundStatus(already.status),
        raw: already as unknown as Record<string, unknown>,
      }
    }

    const refund = await call<RzpRefund>('POST', `/payments/${payId}/refund`, {
      amount: args.amountInPaise,
      receipt: args.idempotencyKey,
      // `speed: 'normal'` on purpose. 'optimum' costs more and settles sooner,
      // which is a commercial decision and not one to make silently here.
      speed: 'normal',
      notes: { note: args.note ?? '', idempotencyKey: args.idempotencyKey },
    })

    return {
      providerRefundId: refund.id,
      /**
       * Reported as they report it, and usually `pending` → PROCESSING. Even a
       * `processed` here is only their answer to this call; the row still waits
       * for `refund.processed` to settle it (§8, §12).
       */
      status: refundStatus(refund.status),
      raw: refund as unknown as Record<string, unknown>,
    }
  },

  async getRefund(providerRefundId: string): Promise<ProviderRefundState | null> {
    if (!providerRefundId.startsWith(REFUND_PREFIX)) return null
    const refund = await call<RzpRefund>('GET', `/refunds/${providerRefundId}`)
    if (!refund) return null
    return {
      providerRefundId,
      status: refundStatus(refund.status),
      amountInPaise: refund.amount,
      raw: refund as unknown as Record<string, unknown>,
    }
  },

  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
    return safeEqual(signRazorpayWebhook(body), signature)
  },

  /**
   * Their envelope, unwrapped.
   *
   *   { event: 'payment.captured', payload: { payment: { entity: {…} } } }
   *
   * Five events are acted on. Everything else Razorpay sends — `order.paid`,
   * settlements, disputes, whatever they add next year — returns null and is
   * answered 200, because retrying an event we will never act on helps nobody.
   */
  parseWebhook(rawBody: Buffer | string): ParsedWebhook | null {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')

    let envelope: { event?: string; payload?: Record<string, { entity?: unknown }> }
    try {
      envelope = JSON.parse(body) as typeof envelope
    } catch {
      throw badRequest('That webhook body is not JSON')
    }

    const event = String(envelope.event ?? '')

    if (event.startsWith('payment.')) {
      const entity = envelope.payload?.payment?.entity as RzpPayment | undefined
      if (!entity?.id) throw badRequest('That webhook names no payment')

      const status =
        event === 'payment.captured'
          ? ('CAPTURED' as const)
          : event === 'payment.authorized'
            ? ('AUTHORIZED' as const)
            : event === 'payment.failed'
              ? ('FAILED' as const)
              : null
      // `payment.pending`, `payment.dispute.*` and friends. Understood, ignored.
      if (!status) return null

      /**
       * Reported under the **order** id, because that is what our `payments`
       * row was written with. The `pay_…` is not lost — it is `raw.id`, which
       * is stored verbatim in `provider_response` and is what a human needs in
       * the Razorpay dashboard.
       *
       * An event with no `order_id` cannot be matched to anything of ours.
       * Falling back to the payment id makes the lookup miss cleanly and answer
       * 200 rather than throw, which is the right shape for somebody else's
       * event arriving on our URL.
       */
      const providerPaymentId = entity.order_id ?? entity.id

      return {
        kind: 'payment',
        // Razorpay's own event id is in the `X-Razorpay-Event-Id` header, not
        // the body, and this method only sees the body. Synthesised from the
        // parts that identify the event instead — it is a ledger reference and
        // a log line, never the idempotency guard, which is the row's status.
        eventId: `${event}:${entity.id}`,
        providerPaymentId,
        status,
        amountInPaise: entity.amount,
        reference: (entity.notes?.reference as string | undefined) ?? null,
        failureReason: entity.error_description ?? entity.error_reason ?? null,
        raw: entity as unknown as Record<string, unknown>,
      }
    }

    if (event.startsWith('refund.')) {
      const entity = envelope.payload?.refund?.entity as RzpRefund | undefined
      if (!entity?.id) throw badRequest('That webhook names no refund')

      const status =
        event === 'refund.processed'
          ? ('SUCCEEDED' as const)
          : event === 'refund.failed'
            ? ('FAILED' as const)
            : null
      // `refund.created`, `refund.speed_changed` — a refund still in flight is
      // not a settlement, and settling on one would pay the customer on paper
      // before the bank had moved anything.
      if (!status) return null

      return {
        kind: 'refund',
        eventId: `${event}:${entity.id}`,
        providerRefundId: entity.id,
        /**
         * Their `payment_id` is a `pay_…`, and our payment row is keyed on an
         * `order_…`. Null rather than a mismatched id: `handleRefundEvent`
         * finds the refund by its own provider id and uses this only for a log
         * line, so a wrong value here would be worse than none.
         */
        providerPaymentId: null,
        status,
        amountInPaise: entity.amount,
        failureReason: status === 'FAILED' ? 'Razorpay could not process the refund' : null,
        raw: entity as unknown as Record<string, unknown>,
      }
    }

    return null
  },
}
