import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import {
  reorderSchema,
  uuidParamSchema,
  valueParamSchema,
} from '../../schemas/admin/common.schema.js'
import {
  attributeListQuerySchema,
  createAttributeSchema,
  createAttributeValueSchema,
  updateAttributeSchema,
  updateAttributeValueSchema,
} from '../../schemas/admin/attribute.schema.js'
import * as controller from './admin.attributes.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminAttributesRouter: Router = Router()

adminAttributesRouter.get('/', validate({ query: attributeListQuerySchema }), controller.list)

adminAttributesRouter.post('/', validate({ body: createAttributeSchema }), controller.create)

// ─── values ──────────────────────────────────────────────────────────────────
//
// Declared before `/:id`, or Express matches 'values' as an id on the reorder
// route and the uuid param schema rejects it with a 400.

adminAttributesRouter.patch(
  '/:id/values/reorder',
  validate({ params: uuidParamSchema, body: reorderSchema }),
  controller.reorderValues,
)

adminAttributesRouter.get(
  '/:id/values',
  validate({ params: uuidParamSchema }),
  controller.listValues,
)

adminAttributesRouter.post(
  '/:id/values',
  validate({ params: uuidParamSchema, body: createAttributeValueSchema }),
  controller.createValue,
)

adminAttributesRouter.patch(
  '/:id/values/:valueId',
  validate({ params: valueParamSchema, body: updateAttributeValueSchema }),
  controller.updateValue,
)

adminAttributesRouter.delete(
  '/:id/values/:valueId',
  validate({ params: valueParamSchema }),
  controller.removeValue,
)

// ─── the attribute itself ────────────────────────────────────────────────────

adminAttributesRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminAttributesRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateAttributeSchema }),
  controller.update,
)

adminAttributesRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
