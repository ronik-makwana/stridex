import type { RequestHandler } from 'express'
import { prisma } from '../../lib/prisma.js'
import { validatedParams } from '../../middleware/validate.js'
import type { SlugParam } from '../../schemas/shop/common.schema.js'
import { serializeShopCollection } from '../../serializers/shop/collection.serializer.js'
import { buildWhere } from './rules.engine.js'
import { findActiveCollectionBySlug } from '../products/shop.catalog.service.js'

/** Only products a customer could actually buy count towards a collection. */
const sellable = { status: 'ACTIVE', variants: { some: { status: 'ACTIVE' } } } as const

async function countProducts(collection: {
  id: string
  type: 'MANUAL' | 'DYNAMIC'
  matchType: 'ALL' | 'ANY'
  rules: { field: string; operator: string; value: unknown }[]
}): Promise<number> {
  if (collection.type === 'MANUAL') {
    return prisma.product.count({
      where: { ...sellable, collections: { some: { collectionId: collection.id } } },
    })
  }
  const where = await buildWhere(
    collection.rules.map((rule) => ({
      field: rule.field,
      operator: rule.operator as never,
      value: rule.value as never,
    })),
    collection.matchType,
  )
  return prisma.product.count({ where: { AND: [sellable, where] } })
}

/** The `/collections` tile index. ACTIVE only — a DRAFT collection is invisible. */
export const list: RequestHandler = async (_req, res) => {
  const collections = await prisma.collection.findMany({
    where: { status: 'ACTIVE' },
    include: { rules: true },
    orderBy: { name: 'asc' },
  })

  const counts = await Promise.all(collections.map(countProducts))

  res.status(200).json({
    data: collections
      .map((collection, index) => serializeShopCollection(collection, counts[index]!))
      // An empty collection is a tile that leads to an empty grid. Hide it
      // rather than publish a dead end — the admin still sees it.
      .filter((collection) => collection.productCount > 0),
  })
}

export const detail: RequestHandler = async (req, res) => {
  const { slug } = validatedParams<SlugParam>(req)
  const collection = await findActiveCollectionBySlug(slug)
  res.status(200).json({
    data: serializeShopCollection(collection, await countProducts(collection)),
  })
}
