import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { suggestQuerySchema } from '../../schemas/shop/catalog.schema.js'
import * as controller from './shop.search.controller.js'

export const shopSearchRouter: Router = Router()

/*
 * There is no `GET /search` here on purpose. Search results are the product
 * grid with a `q` filter — `GET /products?q=` — and giving them a second
 * endpoint would mean a second query to keep in step with the facets. The
 * storefront's /search route calls /products.
 */
shopSearchRouter.get('/suggest', validate({ query: suggestQuerySchema }), controller.suggest)
