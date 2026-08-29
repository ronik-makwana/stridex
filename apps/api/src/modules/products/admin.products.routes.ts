import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { reorderSchema, uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  bulkProductSchema,
  bulkVariantSchema,
  createMediaSchema,
  createProductSchema,
  createVariantSchema,
  duplicateProductSchema,
  generateVariantsSchema,
  mediaParamSchema,
  presignMediaSchema,
  productListQuerySchema,
  productStatusSchema,
  updateMediaSchema,
  updateProductSchema,
  updateVariantSchema,
  variantParamSchema,
} from '../../schemas/admin/product.schema.js'
import * as controller from './admin.products.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminProductsRouter: Router = Router()

adminProductsRouter.get('/', validate({ query: productListQuerySchema }), controller.list)

// Before `/:id`, or Express matches 'bulk' as an id and the uuid param schema
// rejects it with a 400.
adminProductsRouter.post('/bulk', validate({ body: bulkProductSchema }), controller.bulk)

adminProductsRouter.post('/', validate({ body: createProductSchema }), controller.create)

// ─── media ───────────────────────────────────────────────────────────────────
//
// Ordered longest-literal-first for the same reason: 'presign' and 'reorder'
// must not be read as a media id.

adminProductsRouter.post(
  '/:id/media/presign',
  validate({ params: uuidParamSchema, body: presignMediaSchema }),
  controller.presignMedia,
)

adminProductsRouter.patch(
  '/:id/media/reorder',
  validate({ params: uuidParamSchema, body: reorderSchema }),
  controller.reorderMedia,
)

adminProductsRouter.get('/:id/media', validate({ params: uuidParamSchema }), controller.listMedia)

adminProductsRouter.post(
  '/:id/media',
  validate({ params: uuidParamSchema, body: createMediaSchema }),
  controller.createMedia,
)

adminProductsRouter.patch(
  '/:id/media/:mediaId',
  validate({ params: mediaParamSchema, body: updateMediaSchema }),
  controller.updateMedia,
)

adminProductsRouter.delete(
  '/:id/media/:mediaId',
  validate({ params: mediaParamSchema }),
  controller.removeMedia,
)

// ─── variants ────────────────────────────────────────────────────────────────

adminProductsRouter.post(
  '/:id/variants/generate',
  validate({ params: uuidParamSchema, body: generateVariantsSchema }),
  controller.generateVariants,
)

adminProductsRouter.patch(
  '/:id/variants/bulk',
  validate({ params: uuidParamSchema, body: bulkVariantSchema }),
  controller.bulkVariants,
)

adminProductsRouter.get(
  '/:id/variants',
  validate({ params: uuidParamSchema }),
  controller.listVariants,
)

adminProductsRouter.post(
  '/:id/variants',
  validate({ params: uuidParamSchema, body: createVariantSchema }),
  controller.createVariant,
)

adminProductsRouter.patch(
  '/:id/variants/:variantId',
  validate({ params: variantParamSchema, body: updateVariantSchema }),
  controller.updateVariant,
)

adminProductsRouter.delete(
  '/:id/variants/:variantId',
  validate({ params: variantParamSchema }),
  controller.removeVariant,
)

// ─── lifecycle ───────────────────────────────────────────────────────────────

adminProductsRouter.get(
  '/:id/publish-checklist',
  validate({ params: uuidParamSchema }),
  controller.getPublishChecklist,
)

adminProductsRouter.post('/:id/publish', validate({ params: uuidParamSchema }), controller.publish)

adminProductsRouter.post('/:id/archive', validate({ params: uuidParamSchema }), controller.archive)

adminProductsRouter.post(
  '/:id/duplicate',
  validate({ params: uuidParamSchema, body: duplicateProductSchema }),
  controller.duplicate,
)

adminProductsRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: productStatusSchema }),
  controller.setStatus,
)

// ─── the product itself ──────────────────────────────────────────────────────

adminProductsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminProductsRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateProductSchema }),
  controller.update,
)

adminProductsRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
