import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams } from '../../middleware/validate.js'
import type {
  AddWishlistItemInput,
  HydrateWishlistInput,
  MergeWishlistInput,
  WishlistItemParam,
} from '../../schemas/shop/wishlist.schema.js'
import * as wishlist from './wishlist.service.js'

function ownerId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

/** Public. Saved ids in, tiles out. */
export const hydrate: RequestHandler = async (req, res) => {
  const { productIds } = req.body as HydrateWishlistInput
  res.status(200).json({ data: await wishlist.hydrate(productIds) })
}

export const get: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await wishlist.getWishlist(ownerId(req)) })
}

/** Answers with the whole list, for the same reason the cart does. */
export const addItem: RequestHandler = async (req, res) => {
  const { productId } = req.body as AddWishlistItemInput
  res.status(201).json({ data: await wishlist.addItem(ownerId(req), productId) })
}

export const removeItem: RequestHandler = async (req, res) => {
  const { productId } = validatedParams<WishlistItemParam>(req)
  res.status(200).json({ data: await wishlist.removeItem(ownerId(req), productId) })
}

export const merge: RequestHandler = async (req, res) => {
  const { productIds } = req.body as MergeWishlistInput
  res.status(200).json({ data: await wishlist.merge(ownerId(req), productIds) })
}
