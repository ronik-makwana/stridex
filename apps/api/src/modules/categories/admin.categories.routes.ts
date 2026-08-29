import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  categoryDeleteQuerySchema,
  categoryListQuerySchema,
  categoryReorderSchema,
  categoryStatusSchema,
  createCategorySchema,
  updateCategorySchema,
} from '../../schemas/admin/category.schema.js'
import * as controller from './admin.categories.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminCategoriesRouter: Router = Router()

adminCategoriesRouter.get('/', validate({ query: categoryListQuerySchema }), controller.list)

// Declared before `/:id`, or Express matches 'tree' and 'reorder' as ids and
// the uuid param schema rejects them with a 400.
adminCategoriesRouter.get('/tree', controller.tree)

adminCategoriesRouter.patch(
  '/reorder',
  validate({ body: categoryReorderSchema }),
  controller.reorder,
)

adminCategoriesRouter.post('/', validate({ body: createCategorySchema }), controller.create)

adminCategoriesRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminCategoriesRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateCategorySchema }),
  controller.update,
)

// Its own route rather than a PATCH body: the kebab menu toggles status without
// loading the category into a form, and it keeps the audit trail readable.
adminCategoriesRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: categoryStatusSchema }),
  controller.setStatus,
)

adminCategoriesRouter.delete(
  '/:id',
  validate({ params: uuidParamSchema, query: categoryDeleteQuerySchema }),
  controller.remove,
)
