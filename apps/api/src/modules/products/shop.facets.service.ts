import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'

/**
 * Facet counts for the current query.
 *
 * The contract customers read into a sidebar: **"Mesh (34)" means 34 results
 * within everything else you have already selected.** Getting that wrong in
 * either direction is worse than showing no counts at all — a count that
 * overpromises leads to an empty grid, and one that underpromises hides stock.
 *
 * So every count below is computed against the same `where` the grid uses, with
 * one deliberate exception, explained at `selfExcludedWhere`.
 */

export type FacetValue = { id: string; label: string; count: number }
export type Facet = { id: string; name: string; slug: string; values: FacetValue[] }

/**
 * Counting a facet against a filter that includes *itself* makes every
 * unselected value in it read 0 — pick "Nike" and Adidas shows (0), which looks
 * like "we have no Adidas" rather than "clear Nike to see them".
 *
 * The fix every storefront converges on: when counting facet X, apply every
 * filter except X. Selections in other facets still narrow it.
 */
function selfExcludedWhere(
  base: Prisma.ProductWhereInput,
  drop: (condition: Prisma.ProductWhereInput) => boolean,
): Prisma.ProductWhereInput {
  const and = (base.AND as Prisma.ProductWhereInput[] | undefined) ?? []
  return { AND: and.filter((condition) => !drop(condition)) }
}

export async function brandFacet(where: Prisma.ProductWhereInput): Promise<Facet | null> {
  const scoped = selfExcludedWhere(where, (condition) => 'brandId' in condition)

  const grouped = await prisma.product.groupBy({
    by: ['brandId'],
    where: { ...scoped, brandId: { not: null } },
    _count: { _all: true },
  })
  if (grouped.length === 0) return null

  const brands = await prisma.brand.findMany({
    where: { id: { in: grouped.map((row) => row.brandId as string) }, status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const counts = new Map(grouped.map((row) => [row.brandId as string, row._count._all]))

  return {
    id: 'brand',
    name: 'Brand',
    slug: 'brand',
    values: brands.map((brand) => ({
      id: brand.id,
      label: brand.name,
      count: counts.get(brand.id) ?? 0,
    })),
  }
}

/**
 * One facet per `is_filterable` attribute — which is exactly what the
 * `(attribute_id, attribute_value_id)` composite index on `product_attributes`
 * exists to serve.
 */
export async function attributeFacets(
  where: Prisma.ProductWhereInput,
  selected: Map<string, string[]>,
): Promise<Facet[]> {
  const attributes = await prisma.attribute.findMany({
    where: { isFilterable: true },
    include: { values: { orderBy: [{ position: 'asc' }, { value: 'asc' }] } },
    orderBy: { position: 'asc' },
  })
  if (attributes.length === 0) return []

  const facets = await Promise.all(
    attributes.map(async (attribute) => {
      // Drop this attribute's own condition, keep every other one.
      const scoped = selfExcludedWhere(where, (condition) => {
        const some = (condition.attributes as { some?: { attributeId?: string } } | undefined)?.some
        return some?.attributeId === attribute.id
      })

      // The ids matching everything *except* this facet. Counting the join
      // table directly against that set is one indexed read per attribute.
      const matching = await prisma.product.findMany({ where: scoped, select: { id: true } })
      if (matching.length === 0) return null

      const grouped = await prisma.productAttribute.groupBy({
        by: ['attributeValueId'],
        where: {
          attributeId: attribute.id,
          attributeValueId: { not: null },
          productId: { in: matching.map((row) => row.id) },
        },
        _count: { _all: true },
      })
      const counts = new Map(grouped.map((row) => [row.attributeValueId as string, row._count._all]))

      const values = attribute.values
        .map((value) => ({
          id: value.id,
          label: value.value,
          count: counts.get(value.id) ?? 0,
        }))
        // A value with no matches is dropped unless the customer has it
        // selected — removing the tick they just made would be a filter that
        // fights back.
        .filter((value) => value.count > 0 || selected.get(attribute.id)?.includes(value.id))

      if (values.length === 0) return null
      return { id: attribute.id, name: attribute.name, slug: attribute.slug, values }
    }),
  )

  return facets.filter((facet): facet is Facet => facet !== null)
}

/**
 * The price slider's bounds, over the same filter. Returned as fixed-point
 * strings like every other money value.
 */
export async function priceBounds(where: Prisma.ProductWhereInput) {
  const scoped = selfExcludedWhere(where, (condition) => {
    const some = (condition.variants as { some?: { price?: unknown } } | undefined)?.some
    return Boolean(some && 'price' in some)
  })

  const matching = await prisma.product.findMany({ where: scoped, select: { id: true } })
  if (matching.length === 0) return null

  const aggregate = await prisma.productVariant.aggregate({
    where: { status: 'ACTIVE', productId: { in: matching.map((row) => row.id) } },
    _min: { price: true },
    _max: { price: true },
  })
  if (!aggregate._min.price || !aggregate._max.price) return null

  return {
    // Floored and ceiled to whole rupees: a slider that starts at 449.00 and
    // ends at 6669.00 is noise, and a customer dragging to "450" would
    // otherwise exclude the cheapest product in the catalogue.
    min: Math.floor(Number(aggregate._min.price)),
    max: Math.ceil(Number(aggregate._max.price)),
  }
}
