import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { slugParamSchema } from '../../schemas/shop/common.schema.js'
import { shopProductReviewsRouter } from '../reviews/shop.reviews.routes.js'
import * as controller from './shop.products.controller.js'

export const shopProductsRouter: Router = Router()

/*
 * Phase 13 adds `GET /products` (the grid) and `GET /products/facets`.
 * `facets` is a valid slug as far as `slugParamSchema` is concerned, so it MUST
 * be registered above `/:slug` or it resolves as a product lookup and 404s.
 * The admin router hit the same thing with `products/new`.
 */
shopProductsRouter.get('/:slug', validate({ params: slugParamSchema }), controller.detail)
shopProductsRouter.get(
  '/:slug/related',
  validate({ params: slugParamSchema }),
  controller.related,
)

// Reviews live under the product they belong to. `mergeParams` on that router
// is what lets it read `:slug` from here.
shopProductsRouter.use('/:slug/reviews', shopProductReviewsRouter)
