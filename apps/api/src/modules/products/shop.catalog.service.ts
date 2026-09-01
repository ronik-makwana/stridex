import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import { buildWhere } from '../collections/rules.engine.js'
import { categorySubtreeIds } from '../categories/shop.categories.service.js'
import type { ProductListQuery, ProductSort } from '../../schemas/shop/catalog.schema.js'
import type { ShopProductCardRecord } from '../../serializers/shop/product.serializer.js'

/**
 * The storefront grid, its count, and its facet counts — all from ONE
 * where-clause, built once here and handed to all three.
 *
 * That is the whole point of this file. Build the filter three times and the
 * sidebar starts promising "Mesh (34)" over a grid showing 31, and nobody can
 * tell which of the three is wrong.
 */

export const productCardInclude = {
  brand: { select: { id: true, name: true, slug: true } },
  media: { orderBy: { sortOrder: 'asc' }, take: 1 },
  variants: {
    where: { status: 'ACTIVE' },
    include: { inventory: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ProductInclude

export type ResolvedCollection = {
  id: string
  name: string
  slug: string
  description: string | null
  imageUrl: string | null
  type: 'MANUAL' | 'DYNAMIC'
}

/** An ACTIVE collection by slug. DRAFT and ARCHIVED are 404s (§18). */
export async function findActiveCollectionBySlug(slug: string) {
  const collection = await prisma.collection.findFirst({
    where: { slug, status: 'ACTIVE' },
    include: { rules: true },
  })
  if (!collection) throw notFound('Collection')
  return collection
}

/**
 * The filter, as one Prisma `where`.
 *
 * Composition rules, which are what customers actually expect and are easy to
 * get backwards:
 *   - across different facets  -> AND  (Nike *and* mesh)
 *   - within one facet         -> OR   (Nike *or* Adidas)
 */
export async function buildShopProductWhere(
  query: ProductListQuery,
  attributeFilters: Map<string, string[]>,
): Promise<Prisma.ProductWhereInput> {
  const and: Prisma.ProductWhereInput[] = [
    { status: 'ACTIVE' },
    // A product with no sellable variant is not a product a customer can buy.
    { variants: { some: { status: 'ACTIVE' } } },
  ]

  if (query.category) {
    const category = await prisma.category.findFirst({
      where: { slug: query.category, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!category) throw notFound('Category')
    // The subtree, not the single id: every product here sits on a level-1
    // category, so `categoryId = <Women>` would return an empty grid.
    and.push({ categoryId: { in: await categorySubtreeIds(category.id) } })
  }

  if (query.collection) {
    const collection = await findActiveCollectionBySlug(query.collection)
    if (collection.type === 'MANUAL') {
      and.push({ collections: { some: { collectionId: collection.id } } })
    } else {
      // The same rules engine the admin preview uses, so what a merchandiser
      // saw when saving is what the storefront renders.
      and.push(
        await buildWhere(
          collection.rules.map((rule) => ({
            field: rule.field,
            operator: rule.operator as never,
            value: rule.value as never,
          })),
          collection.matchType,
        ),
      )
    }
  }

  if (query.brand?.length) and.push({ brandId: { in: query.brand } })

  if (query.q) {
    // Trigram GIN indexes exist on products.title and brands.name.
    and.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { brand: { name: { contains: query.q, mode: 'insensitive' } } },
      ],
    })
  }

  // Price is a property of a variant, so "between 2000 and 3000" means *some*
  // sellable variant falls in that band — not that all of them do.
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: Prisma.DecimalFilter = {}
    if (query.minPrice !== undefined) price.gte = new Prisma.Decimal(query.minPrice)
    if (query.maxPrice !== undefined) price.lte = new Prisma.Decimal(query.maxPrice)
    and.push({ variants: { some: { status: 'ACTIVE', price } } })
  }

  // One AND per attribute, each an OR over its chosen values.
  for (const [attributeId, valueIds] of attributeFilters) {
    and.push({
      attributes: { some: { attributeId, attributeValueId: { in: valueIds } } },
    })
  }

  return { AND: and }
}

/**
 * `featured` is the default and means different things in different places:
 * inside a manual collection it is the curator's drag order (handled by the
 * caller, which has to join through `collection_products`), and everywhere else
 * it falls back to newest. Nothing here silently reorders.
 */
export function orderFor(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
    case 'featured':
      // `id` breaks ties so pagination is stable: without it, two products
      // created in the same millisecond can swap between page 1 and page 2.
      return [{ createdAt: 'desc' }, { id: 'asc' }]
    case 'name_asc':
      return [{ title: 'asc' }, { id: 'asc' }]
    case 'price_asc':
    case 'price_desc':
      // Prisma cannot order a product by an aggregate of its variants, so these
      // two are handled by the caller with a raw query. Falling through to
      // newest here would be the silent reorder this phase exists to avoid.
      return [{ createdAt: 'desc' }, { id: 'asc' }]
  }
}

/**
 * Price sorting, which Prisma's query builder cannot express: "cheapest
 * sellable variant" is an aggregate over a relation, and `orderBy` does not
 * reach it. Returns ids in order; the caller hydrates them.
 */
export async function productIdsByPrice(
  where: Prisma.ProductWhereInput,
  direction: 'asc' | 'desc',
  skip: number,
  take: number,
): Promise<string[]> {
  // The filter is already a Prisma object, so the ids it matches are fetched
  // first and the ordering applied over them. Two queries instead of one, and
  // still far simpler than hand-writing the whole filter as SQL.
  const matching = await prisma.product.findMany({ where, select: { id: true } })
  if (matching.length === 0) return []

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM products p
    JOIN LATERAL (
      SELECT min(v.price) AS price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.status = 'ACTIVE'
    ) cheapest ON TRUE
    WHERE p.id = ANY(${matching.map((row) => row.id)}::uuid[])
    ORDER BY cheapest.price ${direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`}, p.id ASC
    OFFSET ${skip} LIMIT ${take}
  `
  return rows.map((row) => row.id)
}

/** Hydrates ids into cards while preserving the order they were given in. */
export async function hydrateCards(ids: string[]): Promise<ShopProductCardRecord[]> {
  if (ids.length === 0) return []
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: productCardInclude,
  })
  const byId = new Map(rows.map((row) => [row.id, row as ShopProductCardRecord]))
  return ids.map((id) => byId.get(id)).filter((row): row is ShopProductCardRecord => Boolean(row))
}
