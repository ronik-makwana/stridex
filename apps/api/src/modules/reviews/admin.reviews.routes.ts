import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  reviewListQuerySchema,
  reviewStatusInputSchema,
} from '../../schemas/admin/review.schema.js'
import * as controller from './admin.reviews.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession`.
 *
 * No POST and no PATCH of the words: a review is the customer's, and an admin
 * who could edit one could put a sentence in somebody's mouth under their name.
 * The tools are hide, unhide, and — for abuse — delete.
 */
export const adminReviewsRouter: Router = Router()

adminReviewsRouter.get('/', validate({ query: reviewListQuerySchema }), controller.list)

// Before `/:id`, or Express reads 'counts' as an id.
adminReviewsRouter.get('/counts', controller.counts)

adminReviewsRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: reviewStatusInputSchema }),
  controller.setStatus,
)

adminReviewsRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
