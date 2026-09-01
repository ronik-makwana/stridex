import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import { paymentListQuerySchema } from '../../schemas/admin/payment.schema.js'
import * as controller from './admin.payments.controller.js'

/**
 * Read-only, and it stays that way at launch. Refunds and voids are provider
 * operations whose truth arrives by webhook; a button here that marked one
 * refunded locally would be a lie the ledger then has to live with.
 */
export const adminPaymentsRouter: Router = Router()

adminPaymentsRouter.get('/', validate({ query: paymentListQuerySchema }), controller.list)

adminPaymentsRouter.get(
  '/:id/transactions',
  validate({ params: uuidParamSchema }),
  controller.transactions,
)

adminPaymentsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)
