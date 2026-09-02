import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { orderNumberParamSchema } from '../../schemas/shop/order.schema.js'
import {
  cancelOrderSchema,
  createReturnSchema,
  requestIdParamSchema,
} from '../../schemas/shop/refund.schema.js'
import * as controller from './shop.refunds.controller.js'

/**
 * Mounted at `/orders`, alongside the read-only orders router rather than
 * inside it: reading your orders and asking for money back are different
 * enough — different service, different rules, different failure modes — that
 * folding them into one file would make the orders module about refunds.
 *
 * Entirely behind the auth wall. There is no way to cancel somebody else's
 * order because there is no way to name one: the lookup is scoped to the
 * session's user (§22).
 */
export const shopRefundsRouter: Router = Router()

shopRefundsRouter.use(authenticate, requireCustomerSession)

shopRefundsRouter.post(
  '/:orderNumber/cancel',
  validate({ params: orderNumberParamSchema, body: cancelOrderSchema }),
  controller.cancel,
)

shopRefundsRouter.post(
  '/:orderNumber/returns',
  validate({ params: orderNumberParamSchema, body: createReturnSchema }),
  controller.requestReturn,
)

/**
 * DELETE, because from the customer's side this un-asks the question. The row
 * is not deleted — a withdrawn request is still a thing that happened, and the
 * returns queue reads it.
 */
shopRefundsRouter.delete(
  '/:orderNumber/returns/:requestId',
  validate({ params: requestIdParamSchema }),
  controller.withdrawReturn,
)
