import type { RequestHandler } from 'express'
import { createHmac } from 'node:crypto'
import { env, isDevelopment } from '../../config/env.js'
import { badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type { ShopUuidParam } from '../../schemas/shop/common.schema.js'
import {
  idempotencyKeySchema,
  type CreatePaymentInput,
} from '../../schemas/shop/payment.schema.js'
import { serializeShopPayment } from '../../serializers/shop/payment.serializer.js'
import * as payments from './payments.service.js'

function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

/**
 * The key is a header, not a body field, because it belongs to the *request*
 * rather than to what is being paid for — and because a retry is a retry of the
 * whole request, headers included.
 *
 * Required, not optional-with-a-fallback. A generated-server-side key would be
 * a new key on every retry, which is exactly the guarantee this is for (§7).
 */
function idempotencyKey(req: Parameters<RequestHandler>[0]): string {
  const raw = req.header('Idempotency-Key')
  const parsed = idempotencyKeySchema.safeParse(raw)
  if (!parsed.success) {
    throw badRequest('This request needs an Idempotency-Key header', {
      'Idempotency-Key': parsed.error.issues[0]?.message ?? 'Send a uuid, reused across retries',
    })
  }
  return parsed.data
}

/**
 * 201 with what the browser needs to complete the attempt. The same key sent
 * again answers 200 with the payment that already exists — a different status
 * on purpose, so a client can tell "I just created this" from "this was already
 * there" without comparing timestamps.
 */
export const create: RequestHandler = async (req, res) => {
  const key = idempotencyKey(req)
  const before = Date.now()
  const payment = await payments.create(ownerId(req), req.body as CreatePaymentInput, key)
  const replayed = payment.createdAt.getTime() < before
  res.status(replayed ? 200 : 201).json({ data: serializeShopPayment(payment) })
}

/** Polled after payment, and read on the confirmation page (§10, §26). */
export const getOne: RequestHandler = async (req, res) => {
  const payment = await payments.findById(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(200).json({ data: serializeShopPayment(payment) })
}

/**
 * The mock's "pay" screen, and the only reason it exists: with no bank in the
 * loop, nothing else can make a payment finish in a browser.
 *
 * It does not shortcut anything. It builds the same body a provider would send,
 * signs it with the same HMAC, and posts it to the real webhook endpoint — so
 * clicking Pay in development exercises signature verification, the parser and
 * the order write exactly as production will (§8).
 *
 * Development only. In production this route does not exist, and the only way
 * to confirm a payment is a provider that actually took money.
 */
export const mockComplete: RequestHandler = async (req, res) => {
  if (!isDevelopment) throw notFound('Route')

  const { id } = validatedParams<ShopUuidParam>(req)
  const outcome = (req.body as { outcome?: string })?.outcome === 'fail' ? 'FAILED' : 'CAPTURED'

  // Owner-scoped like every other read: this is a customer's own payment.
  const payment = await payments.findById(ownerId(req), id)
  if (payment.provider !== 'mock') throw forbidden('That payment is not a mock payment')

  const body = JSON.stringify({
    eventId: `evt_${Date.now()}`,
    providerPaymentId: payment.providerPaymentId,
    status: outcome,
    amountInPaise: Math.round(Number(payment.amount) * 100),
    reference: payment.checkoutSessionId,
    failureReason: outcome === 'FAILED' ? 'Your bank declined the transaction' : null,
  })

  const response = await fetch(
    `http://127.0.0.1:${env.PORT}/api/webhooks/payments/mock`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Webhook-Signature': createHmac('sha256', env.PAYMENT_MOCK_SECRET).update(body).digest('hex'),
      },
      body,
    },
  )

  res.status(response.status).json(await response.json())
}
