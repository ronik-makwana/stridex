import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { orderListQuerySchema, orderNumberParamSchema } from '../../schemas/shop/order.schema.js'
import * as controller from './shop.orders.controller.js'

/** Mounted at `/orders`. Entirely behind the auth wall — these are your own. */
export const shopOrdersRouter: Router = Router()

shopOrdersRouter.use(authenticate, requireCustomerSession)

shopOrdersRouter.get('/', validate({ query: orderListQuerySchema }), controller.list)

shopOrdersRouter.get(
  '/:orderNumber',
  validate({ params: orderNumberParamSchema }),
  controller.getOne,
)
