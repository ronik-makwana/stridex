import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type UuidParam } from '../../schemas/admin/common.schema.js'
import type { PaymentListQuery } from '../../schemas/admin/payment.schema.js'
import * as payments from './admin.payments.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<PaymentListQuery>(req)
  const { data, total } = await payments.findMany(query)
  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

export const getOne: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await payments.findById(validatedParams<UuidParam>(req).id) })
}

export const transactions: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await payments.transactions(validatedParams<UuidParam>(req).id) })
}
