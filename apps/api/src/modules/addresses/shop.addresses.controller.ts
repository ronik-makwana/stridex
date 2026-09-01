import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type { ShopUuidParam } from '../../schemas/shop/common.schema.js'
import { serializeShopAddress } from '../../serializers/shop/address.serializer.js'
import type {
  CreateAddressInput,
  UpdateAddressInput,
} from '../../schemas/shop/address.schema.js'
import * as addresses from './addresses.service.js'

/** The owner comes from the token. There is no route that takes a user id. */
function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

export const list: RequestHandler = async (req, res) => {
  const rows = await addresses.findMany(ownerId(req))
  // No `meta`: an address book is a handful of rows and is never paginated.
  res.status(200).json({ data: rows.map(serializeShopAddress) })
}

export const getOne: RequestHandler = async (req, res) => {
  const address = await addresses.findById(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(200).json({ data: serializeShopAddress(address) })
}

export const create: RequestHandler = async (req, res) => {
  const address = await addresses.create(ownerId(req), req.body as CreateAddressInput)
  res.status(201).json({ data: serializeShopAddress(address) })
}

export const update: RequestHandler = async (req, res) => {
  const address = await addresses.update(
    ownerId(req),
    validatedParams<ShopUuidParam>(req).id,
    req.body as UpdateAddressInput,
  )
  res.status(200).json({ data: serializeShopAddress(address) })
}

export const remove: RequestHandler = async (req, res) => {
  await addresses.remove(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(204).end()
}

export const setDefault: RequestHandler = async (req, res) => {
  const address = await addresses.setDefault(ownerId(req), validatedParams<ShopUuidParam>(req).id)
  res.status(200).json({ data: serializeShopAddress(address) })
}
