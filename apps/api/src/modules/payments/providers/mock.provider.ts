import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { env } from '../../../config/env.js'
import { badRequest } from '../../../lib/errors.js'
import type {
  CreatePaymentArgs,
  CreatedPayment,
  ParsedWebhook,
  PaymentProvider,
  ProviderPaymentState,
} from './provider.types.js'

/**
 * A real implementation of `PaymentProvider` that happens to have no bank
 * behind it — permanent infrastructure, not scaffolding to be deleted when
 * Razorpay arrives.
 *
 * The reason it stays: every failure mode that matters here is one no sandbox
 * lets you trigger on demand. A webhook that arrives twice. A webhook that
 * arrives before the browser returns. One that never arrives at all. A decline.
 * Two customers racing for the last unit while both are mid-payment. Those are
 * the cases the checkout has to survive, and they need to be reproducible in a
 * test rather than waited for.
 *
 * It signs with **the same HMAC-SHA256 scheme Razorpay uses**, over the raw
 * request bytes. That is deliberate: if the mock signed differently, or not at
 * all, `verifySignature` would be dead code until the day real money depended
 * on it.
 */

/** The outcome is encoded in the id, so a test can name what it wants to happen. */
export type MockOutcome = 'success' | 'fail'

const PREFIX = 'mock_pay'

const secret = () => env.PAYMENT_MOCK_SECRET

export function signMockWebhook(rawBody: string): string {
  return createHmac('sha256', secret()).update(rawBody).digest('hex')
}

/**
 * Constant-time, and the length check is part of it: `timingSafeEqual` throws
 * on a length mismatch, which would otherwise leak that much through an
 * exception.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const mockProvider: PaymentProvider = {
  name: 'mock',

  /**
   * Stateless: the id carries everything the mock needs to answer later. No
   * table, no memory — a provider that lost its state on a dev restart would be
   * a provider that cannot reproduce the interesting cases.
   */
  async createPayment(args: CreatePaymentArgs): Promise<CreatedPayment> {
    const providerPaymentId = `${PREFIX}_${randomUUID().replace(/-/g, '')}`
    return {
      providerPaymentId,
      clientPayload: {
        provider: 'mock',
        providerPaymentId,
        amount: args.amountInPaise,
        currency: args.currency,
        reference: args.reference,
        /**
         * How the client completes it. In production this is a hosted page or
         * an SDK handoff; here it is the webhook the caller chooses to send,
         * which is what makes "the browser never came back" a case you can
         * actually test.
         */
        completeVia: 'POST /api/webhooks/payments/mock',
      },
    }
  },

  /**
   * The mock has no ledger of its own, so it can only report what its id
   * encodes. Reconciliation against a real provider reads their record; here it
   * answers PENDING, which is the honest answer for "we never heard back".
   */
  async getPayment(providerPaymentId: string): Promise<ProviderPaymentState | null> {
    if (!providerPaymentId.startsWith(PREFIX)) return null
    return {
      providerPaymentId,
      status: 'PENDING',
      amountInPaise: 0,
      raw: { note: 'The mock keeps no state; reconcile against the webhook you sent.' },
    }
  },

  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
    return safeEqual(signMockWebhook(body), signature)
  },

  parseWebhook(rawBody: Buffer | string): ParsedWebhook {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      throw badRequest('That webhook body is not JSON')
    }

    const status = String(parsed.status ?? '').toUpperCase()
    if (status !== 'AUTHORIZED' && status !== 'CAPTURED' && status !== 'FAILED') {
      throw badRequest(`Unknown payment status "${parsed.status}"`)
    }

    const providerPaymentId = String(parsed.providerPaymentId ?? '')
    if (!providerPaymentId) throw badRequest('That webhook names no payment')

    return {
      // Defaulted rather than required: a provider that retries without an
      // event id still has to be survivable, and the payment id plus status is
      // enough to make the write idempotent on our side.
      eventId: String(parsed.eventId ?? `${providerPaymentId}:${status}`),
      providerPaymentId,
      status,
      amountInPaise: Number(parsed.amountInPaise ?? 0),
      reference: parsed.reference ? String(parsed.reference) : null,
      failureReason: parsed.failureReason ? String(parsed.failureReason) : null,
      raw: parsed,
    }
  },
}
