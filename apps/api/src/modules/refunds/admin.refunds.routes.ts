import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  approveReturnSchema,
  receiveReturnSchema,
  rejectReturnSchema,
  returnListQuerySchema,
} from '../../schemas/admin/refund.schema.js'
import * as controller from './admin.refunds.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession`.
 *
 * No POST: a return is raised by the customer, never typed in here. An operator
 * who could create one could create one against an order that was never
 * delivered — and the whole point of the queue is that it reflects what
 * customers actually asked for.
 *
 * No DELETE either. A withdrawn or rejected request is still something that
 * happened, and the queue is the record of it.
 */
export const adminReturnsRouter: Router = Router()

adminReturnsRouter.get('/', validate({ query: returnListQuerySchema }), controller.list)

adminReturnsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminReturnsRouter.post(
  '/:id/approve',
  validate({ params: uuidParamSchema, body: approveReturnSchema }),
  controller.approve,
)

adminReturnsRouter.post(
  '/:id/reject',
  validate({ params: uuidParamSchema, body: rejectReturnSchema }),
  controller.reject,
)

/**
 * The parcel arrived. Stock moves and money leaves in one transaction, so this
 * is the one route here worth reading twice before changing.
 */
adminReturnsRouter.post(
  '/:id/receive',
  validate({ params: uuidParamSchema, body: receiveReturnSchema }),
  controller.receive,
)
