import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type UuidParam } from '../../schemas/admin/common.schema.js'
import type { ReviewListQuery, ReviewStatusInput } from '../../schemas/admin/review.schema.js'
import * as reviews from './admin.reviews.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<ReviewListQuery>(req)
  const { data, total } = await reviews.findMany(query)
  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

/** The tab counts. One grouped query, so the queue can say what is waiting. */
export const counts: RequestHandler = async (_req, res) => {
  res.status(200).json({ data: await reviews.counts() })
}

export const setStatus: RequestHandler = async (req, res) => {
  const { status } = req.body as ReviewStatusInput
  res.status(200).json({ data: await reviews.setStatus(validatedParams<UuidParam>(req).id, status) })
}

export const remove: RequestHandler = async (req, res) => {
  await reviews.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}
