import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import type { UuidParam } from '../../schemas/admin/common.schema.js'
import type {
  CreateDiscountInput,
  DiscountListQuery,
  DiscountStateInput,
  UpdateDiscountInput,
} from '../../schemas/admin/discount.schema.js'
import * as discounts from './discounts.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<DiscountListQuery>(req)
  const { data, total } = await discounts.findMany(query)
  res.status(200).json({ data, meta: { page: query.page, limit: query.limit, total } })
}

export const getOne: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await discounts.findById(validatedParams<UuidParam>(req).id) })
}

export const create: RequestHandler = async (req, res) => {
  res.status(201).json({ data: await discounts.create(req.body as CreateDiscountInput) })
}

export const update: RequestHandler = async (req, res) => {
  const discount = await discounts.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateDiscountInput,
  )
  res.status(200).json({ data: discount })
}

/**
 * Its own endpoint, not a field on update. Stopping a discount is one click
 * from a list where the rest of the form is not on screen, and making it a full
 * replace would mean sending back thirty fields to change one date.
 */
export const setState: RequestHandler = async (req, res) => {
  const discount = await discounts.setState(
    validatedParams<UuidParam>(req).id,
    (req.body as DiscountStateInput).action,
  )
  res.status(200).json({ data: discount })
}

export const remove: RequestHandler = async (req, res) => {
  await discounts.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}
