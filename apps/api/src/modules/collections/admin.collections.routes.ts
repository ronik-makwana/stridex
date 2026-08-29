import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import {
  paginationSchema,
  reorderSchema,
  uuidParamSchema,
} from '../../schemas/admin/common.schema.js'
import {
  addProductsSchema,
  collectionListQuerySchema,
  collectionProductParamSchema,
  createCollectionSchema,
  previewRulesSchema,
  updateCollectionSchema,
} from '../../schemas/admin/collection.schema.js'
import { productStatusSchema } from '../../schemas/admin/product.schema.js'
import * as controller from './admin.collections.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminCollectionsRouter: Router = Router()

adminCollectionsRouter.get('/', validate({ query: collectionListQuerySchema }), controller.list)

// Literal segments before `/:id`, or Express reads them as ids and the uuid
// param schema rejects them with a 400.
adminCollectionsRouter.get('/rule-fields', controller.ruleFields)

adminCollectionsRouter.post(
  '/preview',
  validate({ body: previewRulesSchema }),
  controller.preview,
)

adminCollectionsRouter.post('/', validate({ body: createCollectionSchema }), controller.create)

// ─── membership ──────────────────────────────────────────────────────────────

adminCollectionsRouter.patch(
  '/:id/products/reorder',
  validate({ params: uuidParamSchema, body: reorderSchema }),
  controller.reorderProducts,
)

adminCollectionsRouter.get(
  '/:id/products',
  validate({ params: uuidParamSchema, query: paginationSchema }),
  controller.listProducts,
)

adminCollectionsRouter.post(
  '/:id/products',
  validate({ params: uuidParamSchema, body: addProductsSchema }),
  controller.addProducts,
)

adminCollectionsRouter.delete(
  '/:id/products/:productId',
  validate({ params: collectionProductParamSchema }),
  controller.removeProduct,
)

// ─── the collection itself ───────────────────────────────────────────────────

adminCollectionsRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: productStatusSchema }),
  controller.setStatus,
)

adminCollectionsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminCollectionsRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateCollectionSchema }),
  controller.update,
)

adminCollectionsRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
