import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { shopUuidParamSchema } from '../../schemas/shop/common.schema.js'
import {
  createAddressSchema,
  updateAddressSchema,
} from '../../schemas/shop/address.schema.js'
import * as controller from './shop.addresses.controller.js'

/**
 * Mounted at `/addresses`. Entirely behind the auth wall — unlike the cart,
 * there is no guest half here: an address with nobody to own it is a row
 * nothing could ever read back.
 */
export const shopAddressesRouter: Router = Router()

shopAddressesRouter.use(authenticate, requireCustomerSession)

shopAddressesRouter.get('/', controller.list)
shopAddressesRouter.post('/', validate({ body: createAddressSchema }), controller.create)

// Before `/:id`, or Express reads 'default' as an id.
shopAddressesRouter.post(
  '/:id/default',
  validate({ params: shopUuidParamSchema }),
  controller.setDefault,
)

shopAddressesRouter.get('/:id', validate({ params: shopUuidParamSchema }), controller.getOne)

shopAddressesRouter.patch(
  '/:id',
  validate({ params: shopUuidParamSchema, body: updateAddressSchema }),
  controller.update,
)

shopAddressesRouter.delete('/:id', validate({ params: shopUuidParamSchema }), controller.remove)
