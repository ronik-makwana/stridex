import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import { orderListQuerySchema, updateOrderStatusSchema } from '../../schemas/admin/order.schema.js'
import * as controller from './admin.orders.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession`.
 *
 * There is no POST and no DELETE here. Orders are created by the payment
 * webhook and nowhere else — an order an operator could type in is an order
 * with no money behind it and no stock accounted for.
 */
export const adminOrdersRouter: Router = Router()

adminOrdersRouter.get('/', validate({ query: orderListQuerySchema }), controller.list)

adminOrdersRouter.get('/:id/history', validate({ params: uuidParamSchema }), controller.history)

adminOrdersRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminOrdersRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: updateOrderStatusSchema }),
  controller.updateStatus,
)
