import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  loadCategoryAncestors,
  productDetailInclude,
  type CategoryRef,
} from './products.repository.js'
import type { ShopProductCardRecord, ShopProductRecord } from '../../serializers/shop/product.serializer.js'

/**
 * Storefront-only product queries. They reuse the includes from
 * `products.repository.ts` rather than declaring their own — a second copy of
 * `productDetailInclude` is how the admin editor and the product page start
 * disagreeing about what a variant is.
 *
 * What they add on top of the shared loaders is the one rule the admin side
 * does not have: only ACTIVE records exist out here.
 */

/**
 * A non-ACTIVE product is a 404, never a 403 (§18). An archived product must
 * not confirm it ever existed — a 403 on `/p/nike-secret-collab` tells anyone
 * guessing slugs exactly which ones are real, which is a product roadmap.
 *
 * The same applies to the brand and category: a product whose brand was
 * archived is not sellable, so it is not findable.
 */
export async function findActiveProductBySlug(
  slug: string,
): Promise<{ product: ShopProductRecord; breadcrumbs: CategoryRef[] }> {
  const product = await prisma.product.findFirst({
    where: {
      slug,
      status: 'ACTIVE',
      // A product hung off an archived category stays reachable by its own URL:
      // the category is a navigation concern, and 404-ing a live product
      // because someone tidied the tree loses an order for no benefit.
    },
    include: productDetailInclude,
  })

  if (!product) throw notFound('Product')

  const ancestors = await loadCategoryAncestors([product.categoryId])
  return {
    product: product as ShopProductRecord,
    breadcrumbs: product.categoryId ? (ancestors.get(product.categoryId) ?? []) : [],
  }
}

/** Just enough of a product to render a card. See `serializeShopProductCard`. */
const productCardInclude = {
  brand: { select: { id: true, name: true, slug: true } },
  // One image. The card shows a cover and nothing else, and pulling five
  // images per card across a 24-card grid is 120 rows to render 24.
  media: { orderBy: { sortOrder: 'asc' }, take: 1 },
  variants: {
    where: { status: 'ACTIVE' },
    include: { inventory: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ProductInclude

const RELATED_LIMIT = 8

/**
 * "You may also like": same category → same brand → newest, excluding this
 * product and anything sold out.
 *
 * The tiers are queried in order and stop as soon as the limit is filled, so a
 * product in a busy category never pays for the brand or newest queries. Each
 * tier excludes the ids already chosen, or a product that is both same-category
 * and same-brand would appear twice.
 *
 * Sold-out products are excluded rather than shown struck through: a
 * recommendation the customer cannot act on is worse than one fewer
 * recommendation. That is the opposite of the rule for *sizes* on the product
 * page, where hiding a sold-out size hides information the customer needs.
 */
export async function findRelatedProducts(product: {
  id: string
  categoryId: string | null
  brandId: string | null
}): Promise<ShopProductCardRecord[]> {
  const collected: ShopProductCardRecord[] = []
  const seen = new Set<string>([product.id])

  const runTier = async (where: Prisma.ProductWhereInput, orderBy: Prisma.ProductOrderByWithRelationInput) => {
    const remaining = RELATED_LIMIT - collected.length
    if (remaining <= 0) return

    const rows = await prisma.product.findMany({
      where: {
        ...where,
        status: 'ACTIVE',
        id: { notIn: [...seen] },
        // At least one ACTIVE variant with something left to sell. Expressed as
        // a relation filter so the database does the excluding — fetching then
        // filtering in Node would return short pages that are hard to explain.
        variants: {
          some: {
            status: 'ACTIVE',
            inventory: { is: { quantity: { gt: 0 } } },
          },
        },
      },
      include: productCardInclude,
      orderBy,
      take: remaining,
    })

    for (const row of rows) {
      seen.add(row.id)
      collected.push(row as ShopProductCardRecord)
    }
  }

  if (product.categoryId) {
    await runTier({ categoryId: product.categoryId }, { createdAt: 'desc' })
  }
  if (product.brandId) {
    await runTier({ brandId: product.brandId }, { createdAt: 'desc' })
  }
  await runTier({}, { createdAt: 'desc' })

  /*
   * `inventory.quantity > 0` above is the coarse filter the database can index.
   * It cannot express "quantity minus reserved", so a product whose entire
   * stock is held by open checkouts survives the query. The serializer's
   * stockBucket() is the authority, so drop those here rather than render a
   * sold-out card in a list that promised none.
   */
  return collected.filter((row) =>
    row.variants.some((v) => (v.inventory?.quantity ?? 0) - (v.inventory?.reservedQuantity ?? 0) > 0),
  )
}
