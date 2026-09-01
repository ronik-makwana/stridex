import type { RequestHandler } from 'express'
import { prisma } from '../../lib/prisma.js'
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

  res.status(200).json({
    data: {
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
    },
  })
}
