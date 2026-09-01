import type { RequestHandler } from 'express'
import { validatedParams } from '../../middleware/validate.js'
import type { SlugParam } from '../../schemas/shop/common.schema.js'
import {
  serializeShopProduct,
  serializeShopProductCard,
} from '../../serializers/shop/product.serializer.js'
import { findActiveProductBySlug, findRelatedProducts } from './shop.products.service.js'

/**
 * Everything public. There is no `authenticate` on these routes and there
 * should not be: a product page that requires a session is a product page
 * search engines cannot read.
 */
export const detail: RequestHandler = async (req, res) => {
  const { slug } = validatedParams<SlugParam>(req)
  const { product, breadcrumbs } = await findActiveProductBySlug(slug)
  res.status(200).json({ data: serializeShopProduct(product, breadcrumbs) })
}

/**
 * A separate request from the detail, on purpose. The buy box must not wait on
 * a recommendation query — the customer came for this product, and "You may
 * also like" is below the fold. It also lets the two cache differently: a
 * product changes when someone edits it, recommendations change whenever any
 * neighbouring product is published or sells out.
 */
export const related: RequestHandler = async (req, res) => {
  const { slug } = validatedParams<SlugParam>(req)
  // Resolved through the same 404-on-non-ACTIVE path, so `related` on an
  // archived slug cannot be used to confirm the slug exists either.
  const { product } = await findActiveProductBySlug(slug)
  const products = await findRelatedProducts(product)
  res.status(200).json({ data: products.map(serializeShopProductCard) })
}
