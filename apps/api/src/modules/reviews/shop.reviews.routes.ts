import { Router } from 'express'
import { authenticate, authenticateOptional } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { shopUuidParamSchema, slugParamSchema } from '../../schemas/shop/common.schema.js'
import {
  createReviewSchema,
  reviewListQuerySchema,
  updateReviewSchema,
} from '../../schemas/shop/review.schema.js'
import * as controller from './shop.reviews.controller.js'

/** Mounted under `/products/:slug` — reading and writing a product's reviews. */
export const shopProductReviewsRouter: Router = Router({ mergeParams: true })

// Public, but reads the token when one is there so an author sees their own
// hidden review and their rows come back marked `isMine`.
shopProductReviewsRouter.get(
  '/',
  authenticateOptional,
  validate({ params: slugParamSchema, query: reviewListQuerySchema }),
  controller.list,
)

shopProductReviewsRouter.post(
  '/',
  authenticate,
  requireCustomerSession,
  validate({ params: slugParamSchema, body: createReviewSchema }),
  controller.create,
)

/** Mounted at the shop root — editing and deleting a review you own. */
export const shopReviewsRouter: Router = Router()

shopReviewsRouter.use(authenticate, requireCustomerSession)

shopReviewsRouter.patch(
  '/:id',
  validate({ params: shopUuidParamSchema, body: updateReviewSchema }),
  controller.update,
)
shopReviewsRouter.delete('/:id', validate({ params: shopUuidParamSchema }), controller.remove)
