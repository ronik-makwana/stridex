import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { paginationSchema, uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  customerListQuerySchema,
  customerStatusInputSchema,
} from '../../schemas/admin/customer.schema.js'
import * as controller from './admin.customers.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession`.
 *
 * Read-heavy on purpose. The two writes — suspend and revoke sessions — are the
 * only things support can do *to* an account, and neither of them can act *as*
 * one. No password editing and no impersonation until there is audit logging to
 * make either accountable.
 */
export const adminCustomersRouter: Router = Router()

adminCustomersRouter.get('/', validate({ query: customerListQuerySchema }), controller.list)

// Literal segments before `/:id`, or Express reads them as ids.
adminCustomersRouter.get(
  '/:id/orders',
  validate({ params: uuidParamSchema, query: paginationSchema }),
  controller.orders,
)
adminCustomersRouter.get('/:id/addresses', validate({ params: uuidParamSchema }), controller.addresses)
adminCustomersRouter.get('/:id/basket', validate({ params: uuidParamSchema }), controller.basket)
adminCustomersRouter.get('/:id/sessions', validate({ params: uuidParamSchema }), controller.sessions)

adminCustomersRouter.post(
  '/:id/sessions/revoke',
  validate({ params: uuidParamSchema }),
  controller.revokeSessions,
)

adminCustomersRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: customerStatusInputSchema }),
  controller.setStatus,
)

adminCustomersRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)
