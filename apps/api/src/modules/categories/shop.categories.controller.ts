import type { RequestHandler } from 'express'
import { validatedParams } from '../../middleware/validate.js'
import type { SlugParam } from '../../schemas/shop/common.schema.js'
import { serializeShopCategory } from '../../serializers/shop/category.serializer.js'
import { findShopCategoryBySlug, findShopTree } from './shop.categories.service.js'

/** Drives the header mega-panel and the mobile drawer. Public and cacheable. */
export const tree: RequestHandler = async (_req, res) => {
  const roots = await findShopTree()
  res.status(200).json({ data: roots.map(serializeShopCategory) })
}

/** Meta only — the grid itself comes from `GET /products?category=`. */
export const detail: RequestHandler = async (req, res) => {
  const { slug } = validatedParams<SlugParam>(req)
  const { category, ancestors } = await findShopCategoryBySlug(slug)
  res.status(200).json({
    data: {
      ...serializeShopCategory(category),
      breadcrumbs: [...ancestors, { id: category.id, name: category.name, slug: category.slug }],
    },
  })
}
