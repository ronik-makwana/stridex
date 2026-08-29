import type { Category } from '@shoe/db'

type CategoryAncestor = { id: string; name: string; slug: string }

type CategoryWithExtras = Category & {
  _count?: { products: number; children: number }
  totalProductCount?: number
  ancestors?: CategoryAncestor[]
  children?: CategoryWithExtras[]
}

/**
 * Two product counts, and the difference matters:
 *
 * `productCount` is what sits directly in this category — the number a delete
 * is blocked on, since `products.category_id` points at one row.
 * `totalProductCount` includes every descendant, which is the number the tree
 * shows, because "Shoes: 3" beside a branch holding 426 products reads as a
 * bug.
 */
/**
 * Written out rather than inferred: `children` makes the shape recursive, and
 * TypeScript cannot infer a return type that refers to itself.
 */
export type AdminCategoryPayload = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  level: number
  position: number
  status: Category['status']
  productCount: number
  totalProductCount: number
  childCount: number
  ancestors: CategoryAncestor[]
  path: string
  children: AdminCategoryPayload[] | null
  createdAt: Date
  updatedAt: Date
}

export function serializeAdminCategory(category: CategoryWithExtras): AdminCategoryPayload {
  const ancestors = category.ancestors ?? []

  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    parentId: category.parentId,
    level: category.level,
    position: category.position,
    status: category.status,
    // Always present, so the UI never has to branch on "did this endpoint
    // include counts" before deciding whether delete is allowed.
    productCount: category._count?.products ?? 0,
    totalProductCount: category.totalProductCount ?? category._count?.products ?? 0,
    childCount: category._count?.children ?? category.children?.length ?? 0,
    ancestors,
    /** 'Shoes > Men > Running'. The one label that identifies a category alone. */
    path: [...ancestors.map((ancestor) => ancestor.name), category.name].join(' > '),
    // Only the tree endpoint nests them. `null` rather than `[]` so the UI can
    // tell "no children" from "children were not asked for".
    children: category.children ? category.children.map(serializeAdminCategory) : null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }
}
