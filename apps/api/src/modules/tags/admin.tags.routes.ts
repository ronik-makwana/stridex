import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { tagListQuerySchema } from '../../schemas/admin/tag.schema.js'
import * as controller from './admin.tags.controller.js'

/**
 * Mounted behind `authenticate` + `requireAdminSession` in admin.routes.ts.
 *
 * Read-only on purpose. Tags are created and removed by editing a product's
 * tag list — there is no tag that exists apart from the products wearing it,
 * so there is nothing for a POST or a DELETE here to mean.
 */
export const adminTagsRouter: Router = Router()

adminTagsRouter.get('/', validate({ query: tagListQuerySchema }), controller.list)
