import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import type { ShopCategoryNode } from '../../serializers/shop/category.serializer.js'

/**
 * The storefront's category tree: ACTIVE only, with rolled-up product counts.
 *
 * Built from two queries — every ACTIVE category, and one grouped count of
 * ACTIVE products per category — then assembled in memory. The table is a few
 * dozen rows, so the alternative (a recursive CTE, or a count query per node)
 * costs more than it saves and is harder to read.
 */
export async function findShopTree(): Promise<ShopCategoryNode[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ level: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    }),
    prisma.product.groupBy({
      by: ['categoryId'],
      where: { status: 'ACTIVE', categoryId: { not: null } },
      _count: { _all: true },
    }),
  ])

  const directCount = new Map(
    counts.map((row) => [row.categoryId as string, row._count._all]),
  )

  const nodes = new Map<string, ShopCategoryNode>(
    categories.map((category) => [category.id, { ...category, children: [], productCount: 0 }]),
  )

  const roots: ShopCategoryNode[] = []
  for (const category of categories) {
    const node = nodes.get(category.id)!
    // A child whose parent is archived is orphaned rather than promoted to a
    // root: it would otherwise appear as a top-level nav item the moment
    // someone archived its parent.
    if (category.parentId) nodes.get(category.parentId)?.children!.push(node)
    else roots.push(node)
  }

  /**
   * Counts roll up from the leaves. Every product in this catalogue sits on a
   * level-1 category, so without this every root — Men, Women, Kids — would
   * show zero.
   */
  const rollUp = (node: ShopCategoryNode): number => {
    const own = directCount.get(node.id) ?? 0
    const fromChildren = (node.children ?? []).reduce((sum, child) => sum + rollUp(child), 0)
    node.productCount = own + fromChildren
    return node.productCount
  }
  roots.forEach(rollUp)

  return roots
}

/** Root-first ancestor chain plus the category itself, for breadcrumbs. */
export async function findShopCategoryBySlug(slug: string) {
  const category = await prisma.category.findFirst({ where: { slug, status: 'ACTIVE' } })
  // An archived category is a 404, not a 403 (§18).
  if (!category) throw notFound('Category')

  const all = await prisma.category.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, parentId: true },
  })
  const byId = new Map(all.map((row) => [row.id, row]))

  const ancestors: { id: string; name: string; slug: string }[] = []
  let cursor = category.parentId
  // Depth guard: the table is a tree by construction, but a cycle here would
  // hang the request rather than fail it.
  while (cursor && ancestors.length < 16) {
    const parent = byId.get(cursor)
    if (!parent) break
    ancestors.unshift({ id: parent.id, name: parent.name, slug: parent.slug })
    cursor = parent.parentId
  }

  return { category, ancestors }
}

/**
 * This category and every descendant. A customer on "Women" expects to see the
 * shoes filed under "Women > Heels", not an empty grid — every product in this
 * catalogue sits on a level-1 category, so a strict `categoryId = ?` would
 * return nothing for all three roots.
 */
export async function categorySubtreeIds(categoryId: string): Promise<string[]> {
  const all = await prisma.category.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, parentId: true },
  })

  const childrenOf = new Map<string, string[]>()
  for (const row of all) {
    if (!row.parentId) continue
    const siblings = childrenOf.get(row.parentId) ?? []
    siblings.push(row.id)
    childrenOf.set(row.parentId, siblings)
  }

  const ids: string[] = []
  const queue = [categoryId]
  while (queue.length > 0 && ids.length < 5_000) {
    const id = queue.shift()!
    if (ids.includes(id)) continue
    ids.push(id)
    queue.push(...(childrenOf.get(id) ?? []))
  }
  return ids
}
