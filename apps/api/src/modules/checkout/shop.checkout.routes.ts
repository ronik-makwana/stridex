import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { shopUuidParamSchema } from '../../schemas/shop/common.schema.js'
import {
  createCheckoutSchema,
  setCheckoutAddressSchema,
} from '../../schemas/shop/checkout.schema.js'
import * as controller from './shop.checkout.controller.js'

/**
 * Mounted at `/checkout`, entirely behind the auth wall — this is where the
 * storefront's guest half ends. Browsing, filling a cart and saving things need
 * no account; holding stock does, because a hold has to belong to someone who
 * can be charged for it.
 *
 * The coupon routes wait until after the flow works end to end.
 */
export const shopCheckoutRouter: Router = Router()

shopCheckoutRouter.use(authenticate, requireCustomerSession)

shopCheckoutRouter.post('/', validate({ body: createCheckoutSchema }), controller.create)

// Before `/:id`, or Express reads 'active' as an id and the uuid schema
// rejects it with a 400.
shopCheckoutRouter.get('/active', controller.getActive)

shopCheckoutRouter.get('/:id', validate({ params: shopUuidParamSchema }), controller.getOne)

shopCheckoutRouter.post(
  '/:id/address',
  validate({ params: shopUuidParamSchema, body: setCheckoutAddressSchema }),
  controller.setAddresses,
)

shopCheckoutRouter.delete('/:id', validate({ params: shopUuidParamSchema }), controller.cancel)
