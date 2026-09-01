import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  createDiscountSchema,
  discountListQuerySchema,
  discountStateSchema,
  updateDiscountSchema,
} from '../../schemas/admin/discount.schema.js'
import * as controller from './admin.discounts.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession`. Definitions only —
 * applying a discount to a cart happens in the checkout quote, where the money
 * is decided.
 */
export const adminDiscountsRouter: Router = Router()

adminDiscountsRouter.get('/', validate({ query: discountListQuerySchema }), controller.list)
adminDiscountsRouter.post('/', validate({ body: createDiscountSchema }), controller.create)

adminDiscountsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)
adminDiscountsRouter.put(
  '/:id',
  validate({ params: uuidParamSchema, body: updateDiscountSchema }),
  controller.update,
)
adminDiscountsRouter.patch(
  '/:id/state',
  validate({ params: uuidParamSchema, body: discountStateSchema }),
  controller.setState,
)
adminDiscountsRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
