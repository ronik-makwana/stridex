import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { slugParamSchema } from '../../schemas/shop/common.schema.js'
import * as controller from './shop.categories.controller.js'

export const shopCategoriesRouter: Router = Router()

// Before `/:slug`, or "tree" is read as a category slug and 404s.
shopCategoriesRouter.get('/tree', controller.tree)
shopCategoriesRouter.get('/:slug', validate({ params: slugParamSchema }), controller.detail)
