import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import {
  reorderSchema,
  uuidParamSchema,
  valueParamSchema,
} from '../../schemas/admin/common.schema.js'
import {
  createVariantOptionSchema,
  createVariantOptionValueSchema,
  updateVariantOptionSchema,
  updateVariantOptionValueSchema,
  variantOptionListQuerySchema,
} from '../../schemas/admin/variant-option.schema.js'
import * as controller from './admin.variant-options.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminVariantOptionsRouter: Router = Router()

adminVariantOptionsRouter.get(
  '/',
  validate({ query: variantOptionListQuerySchema }),
  controller.list,
)

adminVariantOptionsRouter.post(
  '/',
  validate({ body: createVariantOptionSchema }),
  controller.create,
)

// ─── values ──────────────────────────────────────────────────────────────────
//
// Declared before `/:id`, or Express matches 'values' as an id on the reorder
// route and the uuid param schema rejects it with a 400.

adminVariantOptionsRouter.patch(
  '/:id/values/reorder',
  validate({ params: uuidParamSchema, body: reorderSchema }),
  controller.reorderValues,
)

adminVariantOptionsRouter.get(
  '/:id/values',
  validate({ params: uuidParamSchema }),
  controller.listValues,
)

adminVariantOptionsRouter.post(
  '/:id/values',
  validate({ params: uuidParamSchema, body: createVariantOptionValueSchema }),
  controller.createValue,
)

adminVariantOptionsRouter.patch(
  '/:id/values/:valueId',
  validate({ params: valueParamSchema, body: updateVariantOptionValueSchema }),
  controller.updateValue,
)

adminVariantOptionsRouter.delete(
  '/:id/values/:valueId',
  validate({ params: valueParamSchema }),
  controller.removeValue,
)

// ─── the option itself ───────────────────────────────────────────────────────

adminVariantOptionsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminVariantOptionsRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateVariantOptionSchema }),
  controller.update,
)

adminVariantOptionsRouter.delete(
  '/:id',
  validate({ params: uuidParamSchema }),
  controller.remove,
)
