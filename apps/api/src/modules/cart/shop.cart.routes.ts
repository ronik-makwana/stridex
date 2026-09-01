import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { hydrateLimiter } from '../../middleware/rateLimit.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { shopUuidParamSchema } from '../../schemas/shop/common.schema.js'
import {
  addCartItemSchema,
  hydrateCartSchema,
  mergeCartSchema,
  updateCartItemSchema,
} from '../../schemas/shop/cart.schema.js'
import * as controller from './shop.cart.controller.js'

/**
 * Mounted at `/cart`. The split down the middle of this file is the phase's
 * central decision: browsing and filling a bag needs no account, so `hydrate`
 * is public and everything that writes a row is not.
 */
export const shopCartRouter: Router = Router()

/**
 * Public, and rate limited harder than anything else on the storefront. It is
 * an unauthenticated endpoint that takes an array of ids and answers with
 * catalog data — which is a scraping tool if it is left open.
 */
shopCartRouter.post('/hydrate', hydrateLimiter, validate({ body: hydrateCartSchema }), controller.hydrate)

// Everything below owns rows keyed to a customer.
shopCartRouter.use(authenticate, requireCustomerSession)

shopCartRouter.post('/merge', validate({ body: mergeCartSchema }), controller.merge)

shopCartRouter.get('/', controller.get)
shopCartRouter.delete('/', controller.clear)

shopCartRouter.post('/items', validate({ body: addCartItemSchema }), controller.addItem)

shopCartRouter.patch(
  '/items/:id',
  validate({ params: shopUuidParamSchema, body: updateCartItemSchema }),
  controller.updateItem,
)

shopCartRouter.delete(
  '/items/:id',
  validate({ params: shopUuidParamSchema }),
  controller.removeItem,
)
