import { Router } from 'express'
import * as controller from './shop.seo.controller.js'

/**
 * Public and unauthenticated by definition — the caller is a crawler. Mounted
 * outside the rest of the shop tree so the path can stay short enough for a
 * root rewrite to be obvious.
 */
export const shopSeoRouter: Router = Router()

shopSeoRouter.get('/sitemap.xml', controller.sitemap)
