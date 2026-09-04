import type { RequestHandler } from 'express'
import { badRequest, unauthorized } from '../../lib/errors.js'
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
