import type { Category } from '@shoe/db'

export type ShopCategoryNode = Category & {
  children?: ShopCategoryNode[]
  productCount?: number
}

/**
 * A category as the storefront nav and the category page header use it.
 *
 * `productCount` is the number of ACTIVE products in this category *and its
 * descendants* — a parent that shows 0 because every product hangs off its
 * children reads as an empty section and nobody clicks it.
 */
/**
 * Declared rather than inferred: the function recurses through `children`, and
 * TypeScript cannot infer the type of something defined in terms of itself.
 */
export type ShopCategoryPayload = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  level: number
  position: number
  productCount: number
  children?: ShopCategoryPayload[]
}

export function serializeShopCategory(node: ShopCategoryNode): ShopCategoryPayload {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    description: node.description,
    parentId: node.parentId,
    level: node.level,
    position: node.position,
    productCount: node.productCount ?? 0,
    ...(node.children ? { children: node.children.map(serializeShopCategory) } : {}),
  }
}

