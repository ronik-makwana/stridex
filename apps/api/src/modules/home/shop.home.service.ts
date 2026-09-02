import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { CACHE, cached } from '../../lib/cache.js'
import { productCardInclude } from '../products/shop.catalog.service.js'
import { serializeShopProductCard } from '../../serializers/shop/product.serializer.js'
import { ratingsForProducts } from '../reviews/reviews.service.js'

/**
 * Everything the home page renders, in one request.
 *
 * The page is merchandising, and it is built last on purpose: every piece of it
 * is a query that already exists somewhere else — the grid's card, the
 * collection tile, the category tree — arranged differently. Nothing here
 * invents a new shape (§18).
 *
 * One endpoint rather than five because the home page is above the fold in its
 * entirety: five requests would paint it in five stages, and the last of them
 * would still be moving when somebody started reading.
 */

const CARD_LIMIT = 8
const FEATURED_COLLECTIONS = 3

/** A page of cards with their ratings, the way every other grid does it. */
async function cards(where: Prisma.ProductWhereInput, take: number, orderBy: Prisma.ProductOrderByWithRelationInput[]) {
  const rows = await prisma.product.findMany({
    where: { ...where, status: 'ACTIVE' },
    include: productCardInclude,
    orderBy,
    take,
  })
  const ratings = await ratingsForProducts(rows.map((row) => row.id))
  return rows.map((row) => serializeShopProductCard(row, ratings.get(row.id)))
}

/**
 * A markdown is `compare_at_price > price` on some variant — the same test the
 * discount pill is drawn from, so a product on this row cannot fail to show a
 * badge when the customer arrives.
 */
const ON_SALE: Prisma.ProductWhereInput = {
  variants: { some: { compareAtPrice: { gt: prisma.productVariant.fields.price } } },
}

/**
 * A picture for a tile that has none of its own. Collections and categories are
 * filed by merchandisers who do not always have an image to hand, and a grey
 * box in a row of photographs reads as a broken page rather than an empty one.
 */
async function coverFor(where: Prisma.ProductWhereInput): Promise<string | null> {
  const product = await prisma.product.findFirst({
    where: { ...where, status: 'ACTIVE', media: { some: {} } },
    select: { media: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return product?.media[0]?.url ?? null
}

/** The subtree of a root category, so 'Men' shows what is filed under Men > anything. */
async function subtreeIds(rootId: string): Promise<string[]> {
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } })
  const children = new Map<string, string[]>()
  for (const row of all) {
    if (!row.parentId) continue
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id])
  }
  const ids: string[] = []
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (ids.includes(current)) continue
    ids.push(current)
    queue.push(...(children.get(current) ?? []))
  }
  return ids
}

/**
 * The chips in the "Top categories" band: every leaf category, labelled the way
 * a shopper would say it — "Men's Sneakers", not "Sneakers" filed under Men —
 * plus every live collection.
 *
 * Both kinds go in one list because the band is one thought: places worth
 * starting from. Which of them is a category and which a collection is our
 * filing, not the shopper's question.
 */
async function topLinks() {
  const [leaves, collections] = await Promise.all([
    prisma.category.findMany({
      where: { status: 'ACTIVE', parentId: { not: null } },
      select: { id: true, name: true, slug: true, parent: { select: { name: true } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    }),
    prisma.collection.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return [
    ...leaves.map((leaf) => ({
      id: leaf.id,
      // "Kids" is already plural, so it takes a bare apostrophe.
      label: leaf.parent
        ? `${leaf.parent.name}${leaf.parent.name.endsWith('s') ? "'" : "'s"} ${leaf.name}`
        : leaf.name,
      to: `/categories/${leaf.slug}`,
    })),
    ...collections.map((collection) => ({
      id: collection.id,
      label: collection.name,
      to: `/collections/${collection.slug}`,
    })),
  ]
}

/**
 * Brand testimonials, from the table an admin curates — **not** promoted
 * reviews.
 *
 * The distinction is the point. A review is one customer's opinion of one
 * product, tied to a purchase, and it belongs on that product's page. A
 * testimonial is a quote somebody chose to put on the front page. Sourcing the
 * second from the first would publish a customer's words somewhere they never
 * agreed to, and would make it impossible to quote anything that did not arrive
 * through the review form.
 */
async function testimonials(limit = 3) {
  const rows = await prisma.testimonial.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  })

  return rows.map((row) => ({
    id: row.id,
    quote: row.quote,
    authorName: row.authorName,
    authorRole: row.authorRole,
    rating: row.rating,
    imageUrl: row.imageUrl,
  }))
}

/**
 * Six queries on the single most-requested URL on the site, over merchandising
 * that changes when somebody curates it — not per request.
 *
 * Five minutes rather than the tree's fifteen: this is the page an operator
 * looks at right after publishing a collection, and a quarter of an hour of
 * "why isn't it showing" is how people learn to distrust the admin.
 */
export function home() {
  return cached(CACHE.home, 'page', 300, loadHome)
}

async function loadHome() {
  const [roots, collections, newArrivals, onSale, links, quotes] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null, status: 'ACTIVE' },
      select: { id: true, name: true, slug: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    }),
    /**
     * Curated first: a manual collection is one somebody chose the contents of,
     * and it is the thing worth putting on a home page. A rule-driven one is
     * still reachable from /collections.
     */
    prisma.collection.findMany({
      where: { status: 'ACTIVE', type: 'MANUAL', products: { some: {} } },
      select: { id: true, name: true, slug: true, description: true, imageUrl: true },
      orderBy: { updatedAt: 'desc' },
      take: FEATURED_COLLECTIONS,
    }),
    cards({}, CARD_LIMIT, [{ createdAt: 'desc' }, { id: 'asc' }]),
    cards(ON_SALE, CARD_LIMIT, [{ createdAt: 'desc' }, { id: 'asc' }]),
    topLinks(),
    testimonials(),
  ])

  const categories = await Promise.all(
    roots.map(async (root) => ({
      id: root.id,
      name: root.name,
      slug: root.slug,
      // Categories have no image of their own, so the tile borrows the newest
      // photographed product filed under them.
      image: await coverFor({ categoryId: { in: await subtreeIds(root.id) } }),
    })),
  )

  const featured = await Promise.all(
    collections.map(async (collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description,
      image:
        collection.imageUrl ??
        (await coverFor({ collections: { some: { collectionId: collection.id } } })),
    })),
  )

  return {
    /**
     * The hero's backdrop, taken from the newest photographed product rather
     * than an asset nobody has uploaded. It changes as the catalogue does,
     * which is the right behaviour for a shop that has no art department.
     */
    hero: { image: newArrivals[0]?.image ?? null },
    /**
     * The band's backdrop. A different photograph from the hero's, so the page
     * does not repeat itself — and a photograph rather than a flat colour,
     * because the chips are translucent and need something to sit on.
     */
    topCategories: {
      image: onSale[0]?.image?.url ?? newArrivals[1]?.image?.url ?? null,
      links,
    },
    categories,
    collections: featured,
    newArrivals,
    onSale,
    testimonials: quotes,
  }
}
