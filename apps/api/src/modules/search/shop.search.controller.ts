import type { RequestHandler } from 'express'
import { prisma } from '../../lib/prisma.js'
import { CACHE, cached } from '../../lib/cache.js'
import { validatedQuery } from '../../middleware/validate.js'
import { serializeShopProductCard } from '../../serializers/shop/product.serializer.js'
import { productCardInclude } from '../products/shop.catalog.service.js'

/**
 * The header overlay: 5 products and 3 categories, nothing else.
 *
 * Deliberately not the full search endpoint with a small `limit` — this fires
 * on almost every keystroke, so it must stay two cheap indexed reads with no
 * facets, no counts and no pagination. `GET /products?q=` is the real search;
 * this is the dropdown that helps you get there.
 */
export const suggest: RequestHandler = async (req, res) => {
  const { q } = validatedQuery<{ q: string }>(req)

  /**
   * Keyed on the lowercased query, which is what makes this worth caching at
   * all: the head of a search distribution is tiny — "nik", "run", "wom" — and
   * a handful of prefixes account for most keystrokes across all customers.
   *
   * Two minutes. A product published minutes ago not appearing in the dropdown
   * is invisible; the same product missing from the grid would not be, and the
   * grid is not cached here.
   */
  /**
   * Caches the **serialized** payload, not the rows behind it.
   *
   * Caching the Prisma rows is what the first version did, and it was wrong in
   * a way that only appeared on the second request: `Decimal` does not survive
   * `JSON.stringify`, so a cache hit handed the serializer a string where it
   * expected a number and `price.lessThan is not a function` came back as a
   * 500. Storing the finished response makes a hit byte-identical to a miss by
   * construction.
   *
   * Keyed on the lowercased query: the head of a search distribution is tiny —
   * "nik", "run", "wom" — and a few prefixes cover most keystrokes.
   *
   * Two minutes. A product published moments ago missing from the dropdown is
   * invisible; missing from the grid would not be, and the grid is not cached.
   */
  const data = await cached(CACHE.suggest, q.toLowerCase(), 120, async () => {
    const { products, categories } = await loadSuggestions(q)
    return {
      products: products.map((product) => {
        const card = serializeShopProductCard(product)
        // The overlay shows a thumbnail, a name and a price. Everything else
        // on a card is weight this dropdown does not need.
        return {
          id: card.id,
          slug: card.slug,
          title: card.title,
          brand: card.brand?.name ?? null,
          image: card.image?.url ?? null,
          price: card.price,
        }
      }),
      categories,
    }
  })

  res.status(200).json({ data })
}

async function loadSuggestions(q: string) {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        variants: { some: { status: 'ACTIVE' } },
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { brand: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: productCardInclude,
      // Newest first: with no relevance score to rank by, recency is the
      // honest tiebreak, and the trigram index has already done the matching.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 5,
    }),
    prisma.category.findMany({
      where: { status: 'ACTIVE', name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, slug: true },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
      take: 3,
    }),
  ])

  return { products, categories }
}
