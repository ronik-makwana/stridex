import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type { ShopUuidParam } from '../../schemas/shop/common.schema.js'
import type {
  AddCartItemInput,
  HydrateCartInput,
  MergeCartInput,
  UpdateCartItemInput,
} from '../../schemas/shop/cart.schema.js'
import * as cart from './cart.service.js'

/**
 * Every authed handler reads the owner from the token, never from the body or
 * the query. A cart id a client could name is a cart id a client could guess
 * (§18).
 */
function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

/** Public. The guest bag, priced. */
export const hydrate: RequestHandler = async (req, res) => {
  const { items } = req.body as HydrateCartInput
  res.status(200).json({ data: await cart.hydrate(items) })
}

export const get: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await cart.getCart(ownerId(req)) })
}

/**
 * Answers with the whole cart rather than the line that was added. The badge,
 * the drawer and the subtotal all move on an add, and returning one line would
 * mean the client either refetches immediately or does arithmetic it must not
 * do (§21).
 */
export const addItem: RequestHandler = async (req, res) => {
  const body = req.body as AddCartItemInput
  res.status(201).json({ data: await cart.addItem(ownerId(req), body) })
}

export const updateItem: RequestHandler = async (req, res) => {
  const { id } = validatedParams<ShopUuidParam>(req)
  const { quantity } = req.body as UpdateCartItemInput
  res.status(200).json({ data: await cart.updateItem(ownerId(req), id, quantity) })
}

export const removeItem: RequestHandler = async (req, res) => {
  const { id } = validatedParams<ShopUuidParam>(req)
  res.status(200).json({ data: await cart.removeItem(ownerId(req), id) })
}

export const clear: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await cart.clear(ownerId(req)) })
}

/** On login and on register. The client clears localStorage only after this returns. */
export const merge: RequestHandler = async (req, res) => {
  const { items } = req.body as MergeCartInput
  res.status(200).json({ data: await cart.merge(ownerId(req), items) })
}
