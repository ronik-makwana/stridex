import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { shopUuidParamSchema } from '../../schemas/shop/common.schema.js'
import { createPaymentSchema } from '../../schemas/shop/payment.schema.js'
import * as controller from './shop.payments.controller.js'

/**
 * Mounted at `/payments`, behind the auth wall.
 *
 * There is no route here that confirms a payment. The provider's webhook is the
 * only thing allowed to do that, and it lives outside this tree entirely —
 * `/api/webhooks/payments/:provider`, unauthenticated and signature-verified,
 * in 15.6. A browser saying "it worked" is a browser, not a bank (§8, §12).
 */
export const shopPaymentsRouter: Router = Router()

shopPaymentsRouter.use(authenticate, requireCustomerSession)

shopPaymentsRouter.post('/', validate({ body: createPaymentSchema }), controller.create)

shopPaymentsRouter.get('/:id', validate({ params: shopUuidParamSchema }), controller.getOne)

// Development only — 404 in every other environment. See the controller for why
// it goes the long way round through the real, signed webhook.
shopPaymentsRouter.post(
  '/:id/mock-complete',
  validate({ params: shopUuidParamSchema }),
  controller.mockComplete,
)
