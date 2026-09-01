import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { shopUuidParamSchema } from '../../schemas/shop/common.schema.js'
import { createCheckoutSchema } from '../../schemas/shop/checkout.schema.js'
import * as controller from './shop.checkout.controller.js'

/**
 * Mounted at `/checkout`, entirely behind the auth wall — this is where the
 * storefront's guest half ends. Browsing, filling a cart and saving things need
 * no account; holding stock does, because a hold has to belong to someone who
 * can be charged for it.
 *
 * `GET /checkout/:id` lands in 15.4, the coupon and address routes in 15.3.
 */
export const shopCheckoutRouter: Router = Router()

shopCheckoutRouter.use(authenticate, requireCustomerSession)

shopCheckoutRouter.post('/', validate({ body: createCheckoutSchema }), controller.create)

shopCheckoutRouter.delete('/:id', validate({ params: shopUuidParamSchema }), controller.cancel)
