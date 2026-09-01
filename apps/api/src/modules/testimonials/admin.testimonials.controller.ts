import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import {
  listMeta,
  type ReorderInput,
  type UuidParam,
} from '../../schemas/admin/common.schema.js'
import type {
  CreateTestimonialInput,
  TestimonialListQuery,
  UpdateTestimonialInput,
} from '../../schemas/admin/testimonial.schema.js'
import type { EntityStatus } from '@shoe/db'
import * as testimonials from './testimonials.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<TestimonialListQuery>(req)
  const { data, total } = await testimonials.findMany(query)
  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

export const getOne: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await testimonials.findById(validatedParams<UuidParam>(req).id) })
}

export const create: RequestHandler = async (req, res) => {
  res.status(201).json({ data: await testimonials.create(req.body as CreateTestimonialInput) })
}

export const update: RequestHandler = async (req, res) => {
  const data = await testimonials.update(
    validatedParams<UuidParam>(req).id,
    req.body as UpdateTestimonialInput,
  )
  res.status(200).json({ data })
}

export const setStatus: RequestHandler = async (req, res) => {
  const { status } = req.body as { status: EntityStatus }
  res.status(200).json({ data: await testimonials.setStatus(validatedParams<UuidParam>(req).id, status) })
}

export const remove: RequestHandler = async (req, res) => {
  await testimonials.remove(validatedParams<UuidParam>(req).id)
  res.status(204).end()
}

export const reorder: RequestHandler = async (req, res) => {
  await testimonials.reorder((req.body as ReorderInput).ids)
  res.status(204).end()
}
