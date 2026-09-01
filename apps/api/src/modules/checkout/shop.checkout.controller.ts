import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type { ShopUuidParam } from '../../schemas/shop/common.schema.js'
import type {
  CreateCheckoutInput,
  SetCheckoutAddressInput,
  SetShippingMethodInput,
} from '../../schemas/shop/checkout.schema.js'
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

/**
 * "Do I have one open?" — answered with the whole session or `null`.
 *
 * The cart asks this on every load, which is the only way a customer who
 * pressed Back can be told that a checkout exists and that their size is being
 * held for it.
 */
export const getActive: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await checkout.findActive(ownerId(req)) })
}

/**
 * Refresh, back button, a tab reopened an hour later — all of them land here,
 * and none of them creates anything (§26, §27).
 */
export const getOne: RequestHandler = async (req, res) => {
  const session = await checkout.findById(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(200).json({ data: session })
}

/**
 * Answers with the whole session, re-quoted. The address changed shipping, and
 * shipping changed the total — handing back only what was written would leave
 * the summary on screen disagreeing with the row (§21).
 */
export const setAddresses: RequestHandler = async (req, res) => {
  const session = await checkout.setAddresses(
    ownerId(req),
    validatedParams<ShopUuidParam>(req).id,
    req.body as SetCheckoutAddressInput,
  )
  res.status(200).json({ data: session })
}

/**
 * Also answers with the whole session: picking express changed the shipping
 * line, and the shipping line changed the total the Pay button is about to
 * charge (§21).
 */
export const setShippingMethod: RequestHandler = async (req, res) => {
  const session = await checkout.setShippingMethod(
    ownerId(req),
    validatedParams<ShopUuidParam>(req).id,
    (req.body as SetShippingMethodInput).method,
  )
  res.status(200).json({ data: session })
}

/** 204: the stock is back on the shelf and there is nothing left to read. */
export const cancel: RequestHandler = async (req, res) => {
  await checkout.cancel(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(204).end()
}
