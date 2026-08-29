import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { uuidParamSchema } from '../../schemas/admin/common.schema.js'
import {
  brandListQuerySchema,
  brandStatusSchema,
  createBrandSchema,
  updateBrandSchema,
} from '../../schemas/admin/brand.schema.js'
import * as controller from './admin.brands.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts. */
export const adminBrandsRouter: Router = Router()

adminBrandsRouter.get('/', validate({ query: brandListQuerySchema }), controller.list)

adminBrandsRouter.post('/', validate({ body: createBrandSchema }), controller.create)

adminBrandsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)

adminBrandsRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateBrandSchema }),
  controller.update,
)

// Its own route rather than a PATCH body: the kebab menu toggles status without
// loading the brand into a form, and it keeps the audit trail readable.
adminBrandsRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: brandStatusSchema }),
  controller.setStatus,
)

adminBrandsRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
