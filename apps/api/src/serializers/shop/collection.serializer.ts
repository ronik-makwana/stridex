import type { Collection } from '@shoe/db'

/**
 * A collection's *meta* only — name, description, image, type, count.
 *
 * Deliberately no products: the grid comes from `GET /products?collection=`,
 * the same endpoint the category page uses. One product query, one grid, one
 * set of facets. A `products` array here would be the second query this phase
 * exists to avoid.
 *
 * `matchType` and the rules themselves never leave the admin. How a collection
 * decides its members is merchandising strategy, not customer-facing data.
 */
export function serializeShopCollection(
  collection: Collection,
  productCount: number,
) {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    imageUrl: collection.imageUrl,
    /** MANUAL or DYNAMIC — the UI uses it to decide whether Featured means a curated order. */
    type: collection.type,
    productCount,
  }
}

export type ShopCollectionPayload = ReturnType<typeof serializeShopCollection>
