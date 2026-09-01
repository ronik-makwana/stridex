import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { slugParamSchema } from '../../schemas/shop/common.schema.js'
import * as controller from './shop.collections.controller.js'

export const shopCollectionsRouter: Router = Router()

shopCollectionsRouter.get('/', controller.list)
shopCollectionsRouter.get('/:slug', validate({ params: slugParamSchema }), controller.detail)
