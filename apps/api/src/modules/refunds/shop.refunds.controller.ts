import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type { OrderNumberParam } from '../../schemas/shop/order.schema.js'
import type {
  CancelOrderInput,
  CreateReturnInput,
  RequestIdParam,
} from '../../schemas/shop/refund.schema.js'
import * as refunds from './shop.refunds.service.js'

function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

/**
 * Answers with the whole order rather than the refund.
 *
 * The customer is looking at an order page, and after cancelling every part of
 * it reads differently — the status, the timeline, what may still be done to
 * it. Returning the refund alone would leave the client to patch its own copy
 * together and get a detail wrong (§21).
 */
export const cancel: RequestHandler = async (req, res) => {
  const { orderNumber } = validatedParams<OrderNumberParam>(req)
  const input = req.body as CancelOrderInput
  res.status(200).json({ data: await refunds.cancelOrder(ownerId(req), orderNumber, input) })
}

/** Raising a return. 201: this creates a request that did not exist before. */
export const requestReturn: RequestHandler = async (req, res) => {
  const { orderNumber } = validatedParams<OrderNumberParam>(req)
  const input = req.body as CreateReturnInput
  res.status(201).json({ data: await refunds.requestReturn(ownerId(req), orderNumber, input) })
}

export const withdrawReturn: RequestHandler = async (req, res) => {
  const { orderNumber, requestId } = validatedParams<RequestIdParam>(req)
  res.status(200).json({ data: await refunds.withdrawReturn(ownerId(req), orderNumber, requestId) })
}
