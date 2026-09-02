import { createHash } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import { prisma } from '../../lib/prisma.js'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { shopListMeta, type SlugParam } from '../../schemas/shop/common.schema.js'
import {
  parseAttributeFilters,
  type ProductListQuery,
} from '../../schemas/shop/catalog.schema.js'
import {
  serializeShopProduct,
  serializeShopProductCard,
} from '../../serializers/shop/product.serializer.js'
import { findActiveProductBySlug, findRelatedProducts } from './shop.products.service.js'
import { ratingsForProducts } from '../reviews/reviews.service.js'
import {
  buildShopProductWhere,
  findActiveCollectionBySlug,
  hydrateCards,
  orderFor,
  productCardInclude,
  productIdsByPrice,
} from './shop.catalog.service.js'
import {
  attributeFacets,
  brandFacet,
  priceBounds,
} from './shop.facets.service.js'
import { CACHE, cached } from '../../lib/cache.js'
import type { ShopProductCardRecord } from '../../serializers/shop/product.serializer.js'

/**
 * The filter, built once per request and shared by the grid, its count and the
 * facets. Every caller below goes through here — that is what keeps
 * "Mesh (34)" and a grid of 34 in agreement.
 */
async function resolveFilter(req: Request) {
  const query = validatedQuery<ProductListQuery>(req)
  const attributeFilters = parseAttributeFilters(req.query as Record<string, unknown>)
  const where = await buildShopProductWhere(query, attributeFilters)
  return { query, attributeFilters, where }
}

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
  const ratings = await ratingsForProducts(products.map((row) => row.id))
  res.status(200).json({
    data: products.map((row) => serializeShopProductCard(row, ratings.get(row.id))),
  })
}

/**
 * The grid. Serves the category page, collection page and search, because all
 * three are the same query with a different filter — which is exactly why
 * collections are built in this phase rather than a later one.
 */
export const list: RequestHandler = async (req, res) => {
  const { query, where } = await resolveFilter(req)
  const skip = (query.page - 1) * query.limit

  const total = await prisma.product.count({ where })

  let rows: ShopProductCardRecord[]

  if (query.sort === 'price_asc' || query.sort === 'price_desc') {
    // Cheapest sellable variant — an aggregate Prisma's orderBy cannot reach.
    const ids = await productIdsByPrice(
      where,
      query.sort === 'price_asc' ? 'asc' : 'desc',
      skip,
      query.limit,
    )
    rows = await hydrateCards(ids)
  } else if (query.sort === 'featured' && query.collection) {
    const collection = await findActiveCollectionBySlug(query.collection)
    if (collection.type === 'MANUAL') {
      /*
       * The curator's order. Somebody dragged these products into
       * `collection_products.position` in the admin; defaulting to newest
       * discards that silently, nobody reports it, and merchandising quietly
       * stops meaning anything.
       */
      const links = await prisma.collectionProduct.findMany({
        where: { collectionId: collection.id, product: where },
        orderBy: { position: 'asc' },
        select: { productId: true },
        skip,
        take: query.limit,
      })
      rows = await hydrateCards(links.map((link) => link.productId))
    } else {
      rows = (await prisma.product.findMany({
        where,
        include: productCardInclude,
        orderBy: orderFor(query.sort),
        skip,
        take: query.limit,
      })) as ShopProductCardRecord[]
    }
  } else {
    rows = (await prisma.product.findMany({
      where,
      include: productCardInclude,
      orderBy: orderFor(query.sort),
      skip,
      take: query.limit,
    })) as ShopProductCardRecord[]
  }

  // One grouped query for the whole page, not one per card.
  const ratings = await ratingsForProducts(rows.map((row) => row.id))

  res.status(200).json({
    data: rows.map((row) => serializeShopProductCard(row, ratings.get(row.id))),
    meta: { ...shopListMeta(total, query.page, query.limit), sort: query.sort },
  })
}

/**
 * Facet counts for the same filter the grid just used. A separate endpoint so
 * paging through a grid does not recount every facet, and so a slow facet
 * query can never hold up the products themselves.
 */
export const facets: RequestHandler = async (req, res) => {
  const { where, attributeFilters } = await resolveFilter(req)

  /**
   * The most expensive read in the API: eight self-excluded aggregates over the
   * product table, re-run on every filter click.
   *
   * Keyed on the **resolved `where`**, not on the raw query string, and that
   * distinction is the whole reason this key works. `?brand=a&size=9` and
   * `?size=9&brand=a` are the same filter and must be one entry; two customers
   * arriving from differently-ordered links must not each pay for the count.
   * Serialising the resolved filter normalises ordering for free, because it is
   * built in a fixed order regardless of how the query arrived.
   *
   * Sixty seconds. Long enough to absorb a customer clicking through four
   * filters in a row — which is the actual traffic pattern — and short enough
   * that a product going out of stock corrects itself within a minute.
   */
  const payload = await cached(CACHE.facets, facetKey(where), 60, async () => {
    const [brand, attributes, price] = await Promise.all([
      brandFacet(where),
      attributeFacets(where, attributeFilters),
      priceBounds(where),
    ])
    return { facets: [...(brand ? [brand] : []), ...attributes], price }
  })

  res.status(200).json({ data: payload })
}

/**
 * A short, stable key for a filter object.
 *
 * Hashed rather than embedded: a filter with six attribute values serialises to
 * several hundred bytes, and Redis keys that long cost memory on every entry
 * and are unreadable in `SCAN` output. SHA-1 because this is a cache key, not a
 * credential — collisions cost a wrong facet count for sixty seconds, and it is
 * shorter and faster than SHA-256.
 */
function facetKey(where: unknown): string {
  return createHash('sha1').update(JSON.stringify(where)).digest('hex').slice(0, 16)
}
