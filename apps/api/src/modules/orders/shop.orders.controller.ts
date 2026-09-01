import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { shopListMeta } from '../../schemas/shop/common.schema.js'
import type { OrderListQuery, OrderNumberParam } from '../../schemas/shop/order.schema.js'
import * as orders from './orders.service.js'

function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<OrderListQuery>(req)
  const { data, total } = await orders.findMany(ownerId(req), query)
  res.status(200).json({ data, meta: shopListMeta(total, query.page, query.limit) })
}

/**
 * By order number, because that is the string the customer has. Also what the
 * confirmation page polls while the webhook lands, which is why it must be
 * cheap and must never create anything (§10, §26).
 */
export const getOne: RequestHandler = async (req, res) => {
  const { orderNumber } = validatedParams<OrderNumberParam>(req)
  res.status(200).json({ data: await orders.findByNumber(ownerId(req), orderNumber) })
}
