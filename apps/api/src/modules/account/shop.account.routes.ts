import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import {
  changePasswordSchema,
  updateAccountSchema,
} from '../../schemas/shop/account.schema.js'
import * as controller from './shop.account.controller.js'

/**
 * Mounted at `/account`. Reading the account is `/auth/me`, which already
 * exists — this is only the two writes.
 */
export const shopAccountRouter: Router = Router()

shopAccountRouter.use(authenticate, requireCustomerSession)

shopAccountRouter.patch('/', validate({ body: updateAccountSchema }), controller.update)

shopAccountRouter.post(
  '/password',
  validate({ body: changePasswordSchema }),
  controller.changePassword,
)
