import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { hydrateLimiter } from '../../middleware/rateLimit.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import {
  addWishlistItemSchema,
  hydrateWishlistSchema,
  mergeWishlistSchema,
  wishlistItemParamSchema,
} from '../../schemas/shop/wishlist.schema.js'
import * as controller from './shop.wishlist.controller.js'

/** Mounted at `/wishlist`. Public to hydrate, authenticated to store. */
export const shopWishlistRouter: Router = Router()

shopWishlistRouter.post(
  '/hydrate',
  hydrateLimiter,
  validate({ body: hydrateWishlistSchema }),
  controller.hydrate,
)

shopWishlistRouter.use(authenticate, requireCustomerSession)

shopWishlistRouter.post('/merge', validate({ body: mergeWishlistSchema }), controller.merge)

shopWishlistRouter.get('/', controller.get)

shopWishlistRouter.post('/items', validate({ body: addWishlistItemSchema }), controller.addItem)

shopWishlistRouter.delete(
  '/items/:productId',
  validate({ params: wishlistItemParamSchema }),
  controller.removeItem,
)
