import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'

/**
 * The includes and loaders shared by the three product services. They live here
 * rather than in `products.service.ts` so media and variants can reach them
 * without importing the module that imports them back.
 */

/** Root first, self excluded — enough to render 'Shoes > Men > Running'. */
export type CategoryRef = { id: string; name: string; slug: string }

export const brandSelect = { id: true, name: true, slug: true } satisfies Prisma.BrandSelect
export const categorySelect = { id: true, name: true, slug: true } satisfies Prisma.CategorySelect

/** Attribute rows carry their definition: the editor picks a control from the type. */
export const attributeInclude = {
  attribute: true,
  attributeValue: true,
} satisfies Prisma.ProductAttributeInclude

/**
 * Every value the option offers, not only the ones in use. The picker ticks
 * boxes against the full list, and an unticked value has no variant to be
 * discovered from.
 */
export const variantOptionInclude = {
  variantOption: { include: { values: { orderBy: [{ position: 'asc' }, { value: 'asc' }] } } },
} satisfies Prisma.ProductVariantOptionInclude

export const variantInclude = {
  inventory: true,
  optionAssignments: {
    include: { optionValue: { include: { variantOption: true } } },
  },
} satisfies Prisma.ProductVariantInclude

/** Everything the editor renders in one round trip. */
export const productDetailInclude = {
  brand: { select: brandSelect },
  category: { select: categorySelect },
  media: { orderBy: { sortOrder: 'asc' } },
  attributes: { include: attributeInclude, orderBy: { position: 'asc' } },
  variantOptions: { include: variantOptionInclude, orderBy: { position: 'asc' } },
  variants: { include: variantInclude, orderBy: { position: 'asc' } },
} satisfies Prisma.ProductInclude

export type ProductDetailRecord = Prisma.ProductGetPayload<{
  include: typeof productDetailInclude
}>

export type VariantRecord = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>

/** Exists-or-404, without loading a payload nothing is going to read. */
export async function assertProductExists(id: string): Promise<{ id: string; title: string }> {
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, title: true } })
  if (!product) throw notFound('Product')
  return product
}

export async function loadProductDetail(id: string): Promise<ProductDetailRecord> {
  const product = await prisma.product.findUnique({ where: { id }, include: productDetailInclude })
  if (!product) throw notFound('Product')
  return product
}

/**
 * Ancestor chains for a set of categories, built from one read of the whole
 * table. The tree is small — a few hundred rows at most — and a recursive walk
 * per product would be one query per row on a 100-row page.
 */
export async function loadCategoryAncestors(
  categoryIds: (string | null)[],
): Promise<Map<string, CategoryRef[]>> {
  const wanted = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))]
  const result = new Map<string, CategoryRef[]>()
  if (wanted.length === 0) return result

  const all = await prisma.category.findMany({
    select: { id: true, name: true, slug: true, parentId: true },
  })
  const byId = new Map(all.map((row) => [row.id, row]))

  for (const id of wanted) {
    const chain: CategoryRef[] = []
    let cursor = byId.get(id)?.parentId ?? null
    // The depth guard is belt and braces: `categories` is a tree by
    // construction, but a cycle here would hang the request rather than fail it.
    while (cursor && chain.length < 16) {
      const parent = byId.get(cursor)
      if (!parent) break
      chain.unshift({ id: parent.id, name: parent.name, slug: parent.slug })
      cursor = parent.parentId
    }
    result.set(id, chain)
  }

  return result
}

/**
 * Summed available stock per product, for a page of ids. `available` is what
 * can still be sold — on hand minus what pending orders are holding — and it
 * is clamped at zero per variant so one oversold line cannot mask stock sitting
 * on another.
 */
export async function loadStockTotals(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()

  const rows = await prisma.$queryRaw<{ product_id: string; available: number }[]>`
    SELECT pv.product_id,
           COALESCE(SUM(GREATEST(i.quantity - i.reserved_quantity, 0)), 0)::int AS available
    FROM product_variants pv
    LEFT JOIN inventories i ON i.variant_id = pv.id
    WHERE pv.product_id IN (${Prisma.join(productIds)})
      AND pv.status <> 'ARCHIVED'
    GROUP BY pv.product_id
  `

  return new Map(rows.map((row) => [row.product_id, row.available]))
}

/**
 * A category and every category beneath it. Filtering the product list by
 * 'Men' has to include 'Men > Running', or the filter reports zero on a branch
 * that holds hundreds.
 */
export async function loadCategorySubtreeIds(categoryId: string): Promise<string[]> {
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } })

  const childrenOf = new Map<string, string[]>()
  for (const row of all) {
    if (!row.parentId) continue
    const siblings = childrenOf.get(row.parentId) ?? []
    siblings.push(row.id)
    childrenOf.set(row.parentId, siblings)
  }

  const ids: string[] = []
  const queue = [categoryId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (ids.includes(current)) continue
    ids.push(current)
    queue.push(...(childrenOf.get(current) ?? []))
  }
  return ids
}
