import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import {
  adjustStockSchema,
  inventoryListQuerySchema,
  lowStockQuerySchema,
  restockSchema,
  transactionListQuerySchema,
  variantParamSchema,
} from '../../schemas/admin/inventory.schema.js'
import * as controller from './admin.inventory.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminInventoryRouter: Router = Router()

adminInventoryRouter.get('/', validate({ query: inventoryListQuerySchema }), controller.list)

// Literal segments before `/:variantId`, or Express reads 'transactions' as an
// id and the uuid param schema rejects it with a 400.
adminInventoryRouter.get(
  '/transactions',
  validate({ query: transactionListQuerySchema }),
  controller.transactions,
)

adminInventoryRouter.get(
  '/low-stock',
  validate({ query: lowStockQuerySchema }),
  controller.lowStock,
)

adminInventoryRouter.get('/reasons', controller.reasons)

adminInventoryRouter.get(
  '/:variantId/transactions',
  validate({ params: variantParamSchema, query: transactionListQuerySchema }),
  controller.variantTransactions,
)

adminInventoryRouter.post(
  '/:variantId/adjust',
  validate({ params: variantParamSchema, body: adjustStockSchema }),
  controller.adjust,
)

adminInventoryRouter.post(
  '/:variantId/restock',
  validate({ params: variantParamSchema, body: restockSchema }),
  controller.restock,
)

adminInventoryRouter.patch(
  '/:variantId/threshold',
  validate({ params: variantParamSchema, body: controller.thresholdSchema }),
  controller.setThreshold,
)

adminInventoryRouter.get('/:variantId', validate({ params: variantParamSchema }), controller.getOne)
