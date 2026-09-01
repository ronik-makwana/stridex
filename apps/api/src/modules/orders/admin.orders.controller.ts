import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type UuidParam } from '../../schemas/admin/common.schema.js'
import type { OrderListQuery, UpdateOrderStatusInput } from '../../schemas/admin/order.schema.js'
import * as orders from './admin.orders.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<OrderListQuery>(req)
  const { data, total } = await orders.findMany(query)
  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

export const getOne: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await orders.findById(validatedParams<UuidParam>(req).id) })
}

/**
 * The status change carries an author. A history row that says only what
 * happened, and not who did it, is the row somebody wanted three weeks later.
 */
export const updateStatus: RequestHandler = async (req, res) => {
  if (!req.user) throw unauthorized()
  const order = await orders.updateStatus(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateOrderStatusInput,
    req.user.id,
  )
  res.status(200).json({ data: order })
}

export const history: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await orders.history(validatedParams<UuidParam>(req).id) })
}
