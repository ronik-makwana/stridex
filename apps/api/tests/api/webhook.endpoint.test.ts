import { createHmac } from 'node:crypto'
import { prisma } from '@shoe/db'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { createPaidCheckout, resetFactorySequence } from '../setup/factories.js'

/**
 * The webhook endpoint, through the real stack — raw-body capture, signature
 * check, dispatch, and the status code the provider actually receives.
 *
 * The status codes are the contract, not a detail. A provider retries anything
 * that is not 2xx, so answering 500 to an event we will never act on turns one
 * stray delivery into a redelivery loop, and answering 200 to a bad signature
 * silently accepts forged confirmations.
 *
 * This can only be tested here: the raw bytes are captured by a `verify` hook
 * on `express.json` in `app.ts`, so a test that called the controller directly
 * would be checking a code path production never uses.
 */

const app = createApp()
const WEBHOOK_SECRET = 'unit-test-webhook-secret'

const sign = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')

const post = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body)
  const req = request(app)
    .post('/api/webhooks/payments/razorpay')
    .set('Content-Type', 'application/json')
  if (signature !== undefined) req.set('X-Razorpay-Signature', signature)
  return req.send(raw)
}

const capturedBody = (orderId: string, amount: number) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: orderId, amount } } },
})

beforeEach(() => {
  resetFactorySequence()
})

describe('signature checking', () => {
  it('rejects a request with no signature at all', async () => {
    const response = await post(capturedBody('order_x', 100))
    expect(response.status).toBe(401)
  })

  it('rejects a wrong signature', async () => {
    const response = await post(capturedBody('order_x', 100), 'deadbeef')
    expect(response.status).toBe(401)
  })

  /**
   * The reason `app.ts` keeps the raw bytes rather than re-serialising
   * `req.body`: a signature is over what was sent, and a re-encode is a
   * different document.
   */
  it('rejects a body altered after it was signed', async () => {
    const original = JSON.stringify(capturedBody('order_x', 100))
    const tampered = JSON.stringify(capturedBody('order_x', 1))

    const response = await request(app)
      .post('/api/webhooks/payments/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sign(original))
      .send(tampered)

    expect(response.status).toBe(401)
  })

  it('accepts a correctly signed body', async () => {
    const { payment, total } = await createPaidCheckout()
    const body = capturedBody(payment.providerPaymentId, Math.round(Number(total) * 100))
    const response = await post(body, sign(JSON.stringify(body)))

    expect(response.status).toBe(200)
    expect(await prisma.order.count()).toBe(1)
  })
})

describe('what the provider is told', () => {
  /** It will never become interesting, so it must not be retried. */
  it('answers 200 to an event it does not act on', async () => {
    const body = { event: 'order.paid', payload: { order: { entity: { id: 'order_1' } } } }
    const response = await post(body, sign(JSON.stringify(body)))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ received: true, handled: false })
  })

  /** Retrying will never make it known, so this is not a 404 or a 500. */
  it('answers 200 for a payment it has never heard of', async () => {
    const body = capturedBody('order_never_created', 100)
    const response = await post(body, sign(JSON.stringify(body)))

    expect(response.status).toBe(200)
    expect(response.body.handled).toBe(false)
  })

  it('answers 200 to a duplicate delivery and creates no second order', async () => {
    const { payment, total } = await createPaidCheckout()
    const body = capturedBody(payment.providerPaymentId, Math.round(Number(total) * 100))
    const signature = sign(JSON.stringify(body))

    const first = await post(body, signature)
    const second = await post(body, signature)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await prisma.order.count()).toBe(1)
  })

  it('rejects a signed body that is not JSON', async () => {
    const raw = 'not json at all'
    const response = await request(app)
      .post('/api/webhooks/payments/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sign(raw))
      .send(raw)

    /**
     * 400, not 500, and the difference matters here more than anywhere: a
     * provider retries anything that is not 2xx, so a 500 on a body that will
     * never parse is an infinite redelivery loop.
     */
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('BAD_REQUEST')
  })

  it('does not create an order when the amount disagrees with the quote', async () => {
    const { payment } = await createPaidCheckout()
    const body = capturedBody(payment.providerPaymentId, 1)
    const response = await post(body, sign(JSON.stringify(body)))

    expect(response.status).toBe(400)
    expect(await prisma.order.count()).toBe(0)
  })
})

describe('where it is mounted', () => {
  /**
   * Outside both the admin and storefront trees, and it has to stay there: a
   * provider has no session, and the storefront tree's CORS and auth would
   * reject it.
   */
  it('needs no session', async () => {
    const body = { event: 'order.paid', payload: {} }
    const response = await post(body, sign(JSON.stringify(body)))
    expect(response.status).toBe(200)
  })

  it('404s an unknown provider rather than accepting the event', async () => {
    const body = { event: 'payment.captured', payload: {} }
    const response = await request(app)
      .post('/api/webhooks/payments/stripe')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sign(JSON.stringify(body)))
      .send(JSON.stringify(body))

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.order.count()).toBe(0)
  })
})
