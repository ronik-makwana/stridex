import type { RequestHandler } from 'express'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import {
  listMeta,
  type PaginationInput,
  type UuidParam,
} from '../../schemas/admin/common.schema.js'
import { serializeAdminAddress } from '../../serializers/admin/address.serializer.js'
import type {
  CustomerListQuery,
  CustomerStatusInput,
} from '../../schemas/admin/customer.schema.js'
import * as customers from './customers.service.js'

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<CustomerListQuery>(req)
  const { data, total } = await customers.findMany(query)
  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

export const getOne: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await customers.findById(validatedParams<UuidParam>(req).id) })
}

export const orders: RequestHandler = async (req, res) => {
  const { page, limit } = validatedQuery<PaginationInput>(req)
  const { data, total } = await customers.orders(validatedParams<UuidParam>(req).id, page, limit)
  res.status(200).json({ data, meta: listMeta(total, page, limit) })
}

export const addresses: RequestHandler = async (req, res) => {
  const rows = await customers.addresses(validatedParams<UuidParam>(req).id)
  res.status(200).json({ data: rows.map(serializeAdminAddress) })
}

/** Cart and wishlist together: on a support call they are one question. */
export const basket: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await customers.basket(validatedParams<UuidParam>(req).id) })
}

export const sessions: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await customers.sessions(validatedParams<UuidParam>(req).id) })
}

export const setStatus: RequestHandler = async (req, res) => {
  const { status } = req.body as CustomerStatusInput
  res.status(200).json({ data: await customers.setStatus(validatedParams<UuidParam>(req).id, status) })
}

export const revokeSessions: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await customers.revokeSessions(validatedParams<UuidParam>(req).id) })
}
