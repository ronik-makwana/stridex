import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import { orderListQuerySchema, updateOrderStatusSchema } from '../../schemas/admin/order.schema.js'
import { createRefundSchema } from '../../schemas/admin/refund.schema.js'
import * as controller from './admin.orders.controller.js'
import * as refunds from '../refunds/admin.refunds.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession`.
 *
 * No POST of an *order* and no DELETE. Orders are created by the payment
 * webhook and nowhere else — an order an operator could type in is an order
 * with no money behind it and no stock accounted for.
 *
 * The one POST below creates a refund, not an order, and it lives here rather
 * than under `/returns` because it is a decision about an order: nothing came
 * back, and there is no request to attach it to (15.6).
 */
export const adminOrdersRouter: Router = Router()

adminOrdersRouter.get('/', validate({ query: orderListQuerySchema }), controller.list)

adminOrdersRouter.get('/:id/history', validate({ params: uuidParamSchema }), controller.history)

adminOrdersRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminOrdersRouter.post(
  '/:id/refunds',
  validate({ params: uuidParamSchema, body: createRefundSchema }),
  refunds.issueRefund,
)

adminOrdersRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: updateOrderStatusSchema }),
  controller.updateStatus,
)
