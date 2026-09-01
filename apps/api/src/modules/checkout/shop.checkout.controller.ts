import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type { ShopUuidParam } from '../../schemas/shop/common.schema.js'
import type { CreateCheckoutInput } from '../../schemas/shop/checkout.schema.js'
import * as checkout from './checkout.service.js'

function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

/**
 * 201 with the whole session: the client needs the id, the deadline and the
 * priced lines in one answer, and any of those fetched separately is a window
 * in which the page renders a checkout it cannot yet price.
 */
export const create: RequestHandler = async (req, res) => {
  const session = await checkout.create(ownerId(req), req.body as CreateCheckoutInput)
  res.status(201).json({ data: session })
}

/** 204: the stock is back on the shelf and there is nothing left to read. */
export const cancel: RequestHandler = async (req, res) => {
  await checkout.cancel(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(204).end()
}
