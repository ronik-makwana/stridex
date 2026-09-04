import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/lib/errors.js'
import {
  razorpayProvider,
  signRazorpayWebhook,
} from '../../src/modules/payments/providers/razorpay.provider.js'

/**
 * The webhook endpoint has no session, no CORS and no rate limiter. Its only
 * credential is this signature — so `verifySignature` returning true on the
 * wrong bytes is the single worst failure available in this codebase, and it is
 * the kind that ships silently because every legitimate webhook still works.
 *
 * `parseWebhook` is tested beside it because the two are read together: what
 * the endpoint trusts, and what it does with it.
 */

// The same value `tests/setup/env.ts` puts in RAZORPAY_WEBHOOK_SECRET.
const WEBHOOK_SECRET = 'unit-test-webhook-secret'

const sign = (body: string, secret = WEBHOOK_SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex')

const paymentEvent = (event: string, entity: Record<string, unknown>) =>
  JSON.stringify({ event, payload: { payment: { entity } } })

const refundEvent = (event: string, entity: Record<string, unknown>) =>
  JSON.stringify({ event, payload: { refund: { entity } } })

describe('verifySignature', () => {
  const body = paymentEvent('payment.captured', { id: 'pay_1', order_id: 'order_1', amount: 100 })

  it('accepts a signature over exactly these bytes', () => {
    expect(razorpayProvider.verifySignature(body, sign(body))).toBe(true)
  })

  it('accepts the same bytes as a Buffer, which is how the route passes them', () => {
    expect(razorpayProvider.verifySignature(Buffer.from(body, 'utf8'), sign(body))).toBe(true)
  })

  it('refuses a missing signature', () => {
    expect(razorpayProvider.verifySignature(body, undefined)).toBe(false)
    expect(razorpayProvider.verifySignature(body, '')).toBe(false)
  })

  it('refuses a signature made with the wrong secret', () => {
    expect(razorpayProvider.verifySignature(body, sign(body, 'not-the-secret'))).toBe(false)
  })

  /**
   * The reason the raw bytes are kept in `app.ts` rather than re-serialised.
   * Re-encoding this object would reorder nothing and still change the hash the
   * moment a key order or a space differed.
   */
  it('refuses a signature over different bytes, however small the difference', () => {
    const tampered = body.replace('"amount":100', '"amount":1')
    expect(razorpayProvider.verifySignature(tampered, sign(body))).toBe(false)
  })

  it('refuses a truncated signature rather than comparing a prefix', () => {
    expect(razorpayProvider.verifySignature(body, sign(body).slice(0, 32))).toBe(false)
  })

  it('refuses a signature of the right length but the wrong value', () => {
    const wrong = sign(body).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))
    expect(wrong).toHaveLength(sign(body).length)
    expect(razorpayProvider.verifySignature(body, wrong)).toBe(false)
  })

  it('refuses garbage that is not hex at all', () => {
    expect(razorpayProvider.verifySignature(body, 'not-a-signature')).toBe(false)
  })

  it('signs deterministically, so a replayed body verifies the same way twice', () => {
    expect(signRazorpayWebhook(body)).toBe(signRazorpayWebhook(body))
    expect(signRazorpayWebhook(body)).toBe(sign(body))
  })
})

describe('parseWebhook, payment events', () => {
  it('maps payment.captured to CAPTURED', () => {
    const parsed = razorpayProvider.parseWebhook(
      paymentEvent('payment.captured', { id: 'pay_1', order_id: 'order_1', amount: 49900 }),
    )
    expect(parsed).toMatchObject({
      kind: 'payment',
      status: 'CAPTURED',
      amountInPaise: 49900,
      eventId: 'payment.captured:pay_1',
    })
  })

  it('maps payment.authorized and payment.failed', () => {
    expect(
      razorpayProvider.parseWebhook(
        paymentEvent('payment.authorized', { id: 'pay_2', order_id: 'order_2', amount: 1 }),
      ),
    ).toMatchObject({ status: 'AUTHORIZED' })

    expect(
      razorpayProvider.parseWebhook(
        paymentEvent('payment.failed', { id: 'pay_3', order_id: 'order_3', amount: 1 }),
      ),
    ).toMatchObject({ status: 'FAILED' })
  })

  /**
   * The translation this whole file exists for: our `payments` row is keyed on
   * the Razorpay *order* id, because that is the only handle that exists when
   * the attempt is created.
   */
  it('reports a payment under its order id, not its payment id', () => {
    const parsed = razorpayProvider.parseWebhook(
      paymentEvent('payment.captured', { id: 'pay_9', order_id: 'order_9', amount: 100 }),
    )
    expect(parsed?.providerPaymentId).toBe('order_9')
  })

  /** So somebody else's event on our URL misses cleanly and answers 200. */
  it('falls back to the payment id when the event carries no order id', () => {
    const parsed = razorpayProvider.parseWebhook(
      paymentEvent('payment.captured', { id: 'pay_orphan', amount: 100 }),
    )
    expect(parsed?.providerPaymentId).toBe('pay_orphan')
  })

  it('keeps the raw entity, which is what a human needs in the dashboard', () => {
    const parsed = razorpayProvider.parseWebhook(
      paymentEvent('payment.captured', { id: 'pay_raw', order_id: 'order_raw', amount: 100 }),
    )
    expect(parsed?.raw).toMatchObject({ id: 'pay_raw' })
  })

  it('carries a failure reason through when there is one', () => {
    const parsed = razorpayProvider.parseWebhook(
      paymentEvent('payment.failed', {
        id: 'pay_f',
        order_id: 'order_f',
        amount: 100,
        error_description: 'Card declined',
      }),
    )
    expect(parsed).toMatchObject({ status: 'FAILED', failureReason: 'Card declined' })
  })

  it('lifts the reference out of notes', () => {
    const parsed = razorpayProvider.parseWebhook(
      paymentEvent('payment.captured', {
        id: 'pay_n',
        order_id: 'order_n',
        amount: 100,
        notes: { reference: 'checkout-123' },
      }),
    )

    // `ParsedWebhook` is a union and `reference` lives only on the payment arm,
    // so this narrows rather than reaching through an optional chain.
    expect(parsed?.kind).toBe('payment')
    expect(parsed?.kind === 'payment' && parsed.reference).toBe('checkout-123')
  })
})

describe('parseWebhook, refund events', () => {
  it('settles only on refund.processed', () => {
    expect(
      razorpayProvider.parseWebhook(refundEvent('refund.processed', { id: 'rfnd_1', amount: 500 })),
    ).toMatchObject({ kind: 'refund', status: 'SUCCEEDED', providerRefundId: 'rfnd_1' })
  })

  it('maps refund.failed', () => {
    expect(
      razorpayProvider.parseWebhook(refundEvent('refund.failed', { id: 'rfnd_2', amount: 500 })),
    ).toMatchObject({ status: 'FAILED' })
  })

  /**
   * A refund still in flight is not a settlement. Acting on `refund.created`
   * would mark the customer paid before the bank had moved anything.
   */
  it('ignores a refund that has not settled', () => {
    expect(razorpayProvider.parseWebhook(refundEvent('refund.created', { id: 'rfnd_3' }))).toBeNull()
    expect(
      razorpayProvider.parseWebhook(refundEvent('refund.speed_changed', { id: 'rfnd_4' })),
    ).toBeNull()
  })

  /** Their `payment_id` is a `pay_…` and ours is an `order_…`; null beats wrong. */
  it('reports no payment id rather than a mismatched one', () => {
    const parsed = razorpayProvider.parseWebhook(
      refundEvent('refund.processed', { id: 'rfnd_5', payment_id: 'pay_x', amount: 100 }),
    )
    expect(parsed).toMatchObject({ kind: 'refund', providerPaymentId: null })
  })
})

describe('parseWebhook, events we do not act on', () => {
  it.each(['order.paid', 'payment.pending', 'payment.dispute.created', 'settlement.processed'])(
    'returns null for %s so the provider is answered 200 and stops',
    (event) => {
      const body =
        event.startsWith('payment.') || event.startsWith('order.')
          ? paymentEvent(event, { id: 'pay_x', order_id: 'order_x', amount: 1 })
          : JSON.stringify({ event, payload: {} })
      expect(razorpayProvider.parseWebhook(body)).toBeNull()
    },
  )

  it('returns null for an envelope with no event at all', () => {
    expect(razorpayProvider.parseWebhook(JSON.stringify({ payload: {} }))).toBeNull()
  })
})

describe('parseWebhook, malformed input', () => {
  it('rejects a body that is not JSON', () => {
    expect(() => razorpayProvider.parseWebhook('<html>gateway error</html>')).toThrow(AppError)
  })

  it('rejects a payment event naming no payment', () => {
    expect(() =>
      razorpayProvider.parseWebhook(JSON.stringify({ event: 'payment.captured', payload: {} })),
    ).toThrow(AppError)
  })

  it('rejects a refund event naming no refund', () => {
    expect(() =>
      razorpayProvider.parseWebhook(JSON.stringify({ event: 'refund.processed', payload: {} })),
    ).toThrow(AppError)
  })

  it('answers 400 on malformed input, not 500', () => {
    try {
      razorpayProvider.parseWebhook('not json')
      expect.unreachable('a non-JSON body must throw')
    } catch (error) {
      expect((error as AppError).statusCode).toBe(400)
    }
  })
})
