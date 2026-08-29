import type { EntityStatus, Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest, notFound, unprocessable } from '../../lib/errors.js'
import { resolveSlug } from '../../lib/entity-slug.js'
import { MAX_CATEGORY_DEPTH } from '../../schemas/admin/category.schema.js'
import type {
  CategoryListQuery,
  CategoryMove,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../../schemas/admin/category.schema.js'

/**
 * Both counts ride along on every read. `products` gates delete — the FK is
 * `Restrict` — and `children` decides whether a delete needs a `childAction`.
 */
const withCounts = {
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategoryInclude

type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof withCounts }>

export type CategoryAncestor = { id: string; name: string; slug: string }

export type CategoryRecord = CategoryRow & {
  /** This category's products plus every descendant's. What the tree shows. */
  totalProductCount: number
  /** Root first, self excluded. Renders the breadcrumb and the parent picker. */
  ancestors: CategoryAncestor[]
}

export type CategoryTreeNode = CategoryRecord & { children: CategoryTreeNode[] }

/** Query sort keys → columns. Keeps snake_case out of the Prisma call. */
const SORT_COLUMNS = {
  name: 'name',
  position: 'position',
  level: 'level',
  status: 'status',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
} as const satisfies Record<string, keyof Prisma.CategoryOrderByWithRelationInput>

const categorySlugLookup = {
  findBySlug: (slug: string) =>
    prisma.category.findUnique({ where: { slug }, select: { id: true } }),
  findByPrefix: (base: string) =>
    prisma.category.findMany({
      where: { slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
}

// ─── the graph ───────────────────────────────────────────────────────────────
//
// Ancestors, descendants, rolled-up counts and every move validation need the
// shape of the whole tree, not one row. A category tree is a few dozen rows —
// three levels of a shoe catalogue — so it is loaded once per request and
// walked in memory. That is one query where a recursive CTE per concern would
// be four, and it keeps the cycle and depth rules readable.

type Graph = {
  rows: CategoryRow[]
  byId: Map<string, CategoryRow>
  /** Keyed by `parentId`; the `null` bucket is the top level. */
  childrenOf: Map<string | null, CategoryRow[]>
  totals: Map<string, number>
}

/**
 * Rolls each category's product count up into its ancestors. Walking deepest
 * level first means a node's own subtotal is final before its parent reads it,
 * which is a post-order traversal without the recursion — and it terminates
 * even if the parent links were ever to disagree with `level`.
 */
function rollUpProductCounts(rows: CategoryRow[]): Map<string, number> {
  const totals = new Map(rows.map((row) => [row.id, row._count.products]))

  for (const row of [...rows].sort((a, b) => b.level - a.level)) {
    if (!row.parentId) continue
    const parentTotal = totals.get(row.parentId)
    if (parentTotal === undefined) continue
    totals.set(row.parentId, parentTotal + (totals.get(row.id) ?? 0))
  }

  return totals
}

async function loadGraph(): Promise<Graph> {
  const rows = await prisma.category.findMany({
    include: withCounts,
    // Siblings are ordered by position; name is the tiebreaker for rows that
    // have never been dragged and so all sit at 0.
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  })

  const byId = new Map(rows.map((row) => [row.id, row]))
  const childrenOf = new Map<string | null, CategoryRow[]>()
  for (const row of rows) {
    const bucket = childrenOf.get(row.parentId)
    if (bucket) bucket.push(row)
    else childrenOf.set(row.parentId, [row])
  }

  return { rows, byId, childrenOf, totals: rollUpProductCounts(rows) }
}

function ancestorsOf(id: string, graph: Graph): CategoryAncestor[] {
  const chain: CategoryAncestor[] = []
  const seen = new Set<string>([id])

  let cursor = graph.byId.get(id)?.parentId ?? null
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const node = graph.byId.get(cursor)
    if (!node) break
    chain.unshift({ id: node.id, name: node.name, slug: node.slug })
    cursor = node.parentId
  }

  return chain
}

/** Every id below `id`, at any depth. The set a node may not move into. */
function descendantIds(id: string, graph: Graph): string[] {
  const found: string[] = []
  const seen = new Set<string>([id])
  const stack = [id]

  while (stack.length > 0) {
    for (const child of graph.childrenOf.get(stack.pop()!) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      found.push(child.id)
      stack.push(child.id)
    }
  }

  return found
}

/** Levels between a node and its deepest descendant; 0 for a leaf. */
function subtreeHeight(id: string, graph: Graph): number {
  const root = graph.byId.get(id)
  if (!root) return 0

  let deepest = root.level
  for (const descendantId of descendantIds(id, graph)) {
    const node = graph.byId.get(descendantId)
    if (node && node.level > deepest) deepest = node.level
  }

  return deepest - root.level
}

const decorate = (row: CategoryRow, graph: Graph): CategoryRecord => ({
  ...row,
  totalProductCount: graph.totals.get(row.id) ?? row._count.products,
  ancestors: ancestorsOf(row.id, graph),
})

const tooDeep = (name: string) =>
  unprocessable(
    `${name} would sit deeper than ${MAX_CATEGORY_DEPTH} levels`,
    `Categories nest ${MAX_CATEGORY_DEPTH} levels deep. Move it higher up the tree, or flatten the branch below it first.`,
  )

// ─── reads ───────────────────────────────────────────────────────────────────

function buildWhere(query: CategoryListQuery): Prisma.CategoryWhereInput {
  const where: Prisma.CategoryWhereInput = {}
  if (query.status) where.status = query.status
  // 'root' is the only way to ask for "no parent" over a query string, where
  // an absent key already means "anywhere in the tree".
  if (query.parentId) where.parentId = query.parentId === 'root' ? null : query.parentId
  if (query.q) {
    // Operators paste slugs in as often as they type names.
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ]
  }
  return where
}

/**
 * The flat, paginated view — what search and the parent picker read. The tree
 * itself comes from `findTree`, which is unpaginated because a page boundary
 * through a tree renders as orphaned children.
 */
export async function findMany(query: CategoryListQuery) {
  const where = buildWhere(query)

  // Position only orders siblings, so on a flat list it is read shallowest
  // first — which is the order the tree would have printed them in.
  const orderBy: Prisma.CategoryOrderByWithRelationInput[] =
    query.sort.field === 'position'
      ? [{ level: query.sort.direction }, { position: query.sort.direction }, { name: 'asc' }]
      : [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { name: 'asc' }]

  const [data, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      include: withCounts,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.category.count({ where }),
  ])

  const graph = await loadGraph()
  return { data: data.map((row) => decorate(row, graph)), total }
}

/** The whole tree, nested, with rolled-up counts on every node. */
export async function findTree(): Promise<CategoryTreeNode[]> {
  const graph = await loadGraph()

  const build = (parentId: string | null, seen: Set<string>): CategoryTreeNode[] =>
    (graph.childrenOf.get(parentId) ?? [])
      .filter((row) => !seen.has(row.id))
      .map((row) => {
        seen.add(row.id)
        return { ...decorate(row, graph), children: build(row.id, seen) }
      })

  return build(null, new Set())
}

export async function findById(id: string): Promise<CategoryRecord> {
  const graph = await loadGraph()
  const row = graph.byId.get(id)
  if (!row) throw notFound('Category')
  return decorate(row, graph)
}

// ─── writes ──────────────────────────────────────────────────────────────────

/** New rows land at the end of their own sibling row, not the whole table. */
async function nextPosition(parentId: string | null): Promise<number> {
  const last = await prisma.category.findFirst({
    where: { parentId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  return (last?.position ?? -1) + 1
}

export async function create(input: CreateCategoryInput): Promise<CategoryRecord> {
  const parentId = input.parentId ?? null

  // `level` is derived, never accepted: it is the parent's level plus one.
  let level = 0
  if (parentId) {
    const parent = await prisma.category.findUnique({
      where: { id: parentId },
      select: { id: true, name: true, level: true },
    })
    if (!parent) {
      throw badRequest('That parent category no longer exists', {
        parentId: 'Reload and pick a different parent',
      })
    }
    level = parent.level + 1
    if (level > MAX_CATEGORY_DEPTH - 1) throw tooDeep(input.name)
  }

  const slug = await resolveSlug({
    name: input.name,
    explicit: input.slug,
    lookup: categorySlugLookup,
  })

  const created = await prisma.category.create({
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId,
      level,
      position: await nextPosition(parentId),
      status: input.status,
    },
    select: { id: true },
  })

  return findById(created.id)
}

export async function update(id: string, input: UpdateCategoryInput): Promise<CategoryRecord> {
  const graph = await loadGraph()
  const existing = graph.byId.get(id)
  if (!existing) throw notFound('Category')

  // Unchecked, so `parentId` can be written as the scalar it is rather than
  // through a `connect`/`disconnect` pair that says the same thing twice.
  const data: Prisma.CategoryUncheckedUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.status !== undefined) data.status = input.status

  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.name ?? existing.name,
      explicit: input.slug,
      excludeId: id,
      lookup: categorySlugLookup,
    })
  }

  let levelDelta = 0
  let subtree: string[] = []

  if (input.parentId !== undefined && input.parentId !== existing.parentId) {
    const nextParentId = input.parentId
    subtree = descendantIds(id, graph)

    if (nextParentId === id) {
      throw unprocessable(
        `${existing.name} cannot be its own parent`,
        'Pick a different parent, or move it to the top level.',
      )
    }
    // The database has no constraint against this — a cycle would simply become
    // a branch nothing can reach, and a tree walk that never returns.
    if (nextParentId && subtree.includes(nextParentId)) {
      throw unprocessable(
        `${existing.name} cannot move under ${graph.byId.get(nextParentId)?.name ?? 'its own subcategory'}`,
        'That would put the category inside itself. Move the subcategory out first.',
      )
    }

    let nextLevel = 0
    if (nextParentId) {
      const parent = graph.byId.get(nextParentId)
      if (!parent) {
        throw badRequest('That parent category no longer exists', {
          parentId: 'Reload and pick a different parent',
        })
      }
      nextLevel = parent.level + 1
    }
    // The whole branch moves, so it is the deepest leaf that has to fit.
    if (nextLevel + subtreeHeight(id, graph) > MAX_CATEGORY_DEPTH - 1) {
      throw tooDeep(existing.name)
    }

    data.parentId = nextParentId
    data.level = nextLevel
    // Arriving at the end of its new siblings is the only position that cannot
    // collide; a drag that wanted somewhere specific goes through `reorder`.
    data.position = await nextPosition(nextParentId)
    levelDelta = nextLevel - existing.level
  }

  await prisma.$transaction([
    prisma.category.update({ where: { id }, data }),
    // One statement for the branch: every descendant shifts by the same delta,
    // and doing it in the same transaction means no read ever sees a subtree
    // whose levels disagree with its parent links.
    ...(levelDelta !== 0 && subtree.length > 0
      ? [
          prisma.category.updateMany({
            where: { id: { in: subtree } },
            data: { level: { increment: levelDelta } },
          }),
        ]
      : []),
  ])

  return findById(id)
}

export async function setStatus(id: string, status: EntityStatus): Promise<CategoryRecord> {
  // Checked first so a missing row is "Category not found" rather than the
  // generic P2025 the error handler would otherwise turn into a 404.
  const exists = await prisma.category.findUnique({ where: { id }, select: { id: true } })
  if (!exists) throw notFound('Category')

  await prisma.category.update({ where: { id }, data: { status } })
  return findById(id)
}

/**
 * `products.category_id` is `onDelete: Restrict` and so is the self-relation, so
 * the database would refuse both of these anyway — as an opaque foreign key
 * error. Counting first turns each into a 422 the dialog can explain and offer
 * a way forward against.
 */
export async function remove(id: string, childAction: 'block' | 'reparent'): Promise<void> {
  const graph = await loadGraph()
  const category = graph.byId.get(id)
  if (!category) throw notFound('Category')

  // Products first: no `childAction` makes this one survivable, because
  // `products.category_id` is not nullable and nothing here can guess a
  // replacement category for them.
  if (category._count.products > 0) {
    const count = category._count.products
    throw unprocessable(
      `${category.name} still has ${count} ${count === 1 ? 'product' : 'products'}`,
      'Move those products to another category first, or set this one to draft to hide it from the storefront.',
    )
  }

  const children = graph.childrenOf.get(id) ?? []
  if (children.length === 0) {
    await prisma.category.delete({ where: { id } })
    return
  }

  if (childAction === 'block') {
    const count = children.length
    throw unprocessable(
      `${category.name} has ${count} ${count === 1 ? 'subcategory' : 'subcategories'}`,
      category.parentId
        ? `Delete them first, or move them up under ${graph.byId.get(category.parentId)?.name ?? 'its parent'}.`
        : 'Delete them first, or move them up to the top level.',
    )
  }

  // Reparent: the children rise into the deleted category's own slot, so the
  // whole branch below them shifts up exactly one level.
  const base = await nextPosition(category.parentId)
  const branch = descendantIds(id, graph)

  await prisma.$transaction([
    ...children.map((child, index) =>
      prisma.category.update({
        where: { id: child.id },
        data: { parentId: category.parentId, position: base + index },
      }),
    ),
    prisma.category.updateMany({
      where: { id: { in: branch } },
      data: { level: { decrement: 1 } },
    }),
    prisma.category.delete({ where: { id } }),
  ])
}

/**
 * Drag-to-reorder and drag-to-reparent are the same request: each move names
 * where a node landed, and the server settles the rest.
 *
 * Positions are rewritten from the resulting index rather than trusted, so two
 * nodes can never claim the same slot, and `level` is recomputed for every row
 * — a reparent moves a whole branch, and a partial apply would leave a subtree
 * whose depth disagrees with its own parent.
 */
export async function reorder(moves: CategoryMove[]): Promise<CategoryTreeNode[]> {
  const graph = await loadGraph()

  const unknown = moves.filter((move) => !graph.byId.has(move.id))
  if (unknown.length > 0) throw notFound(unknown.length === 1 ? 'Category' : 'Categories')

  // The tree as it would be *after* the moves, resolved before anything is
  // written: a move that only makes sense next to another one still has to be
  // validated against the finished shape, not the current one.
  const parentOf = new Map<string, string | null>(graph.rows.map((row) => [row.id, row.parentId]))
  const requested = new Map<string, number>()

  for (const move of moves) {
    if (move.parentId !== null && !graph.byId.has(move.parentId)) {
      throw badRequest('That parent category no longer exists', {
        parentId: 'Reload and try again',
      })
    }
    if (move.parentId === move.id) {
      throw unprocessable(
        `${graph.byId.get(move.id)!.name} cannot be its own parent`,
        'Drop it on a different category, or at the top level.',
      )
    }
    parentOf.set(move.id, move.parentId)
    requested.set(move.id, move.position)
  }

  const levelOf = new Map<string, number>()

  /** Walks to the root, memoising the chain. Throws if the walk finds a cycle. */
  const resolveLevel = (id: string): number => {
    const chain: string[] = []
    const seen = new Set<string>()

    let cursor: string | null = id
    while (cursor !== null && levelOf.get(cursor) === undefined) {
      if (seen.has(cursor)) {
        throw unprocessable(
          `${graph.byId.get(id)!.name} cannot move inside its own subcategory`,
          'Drop it somewhere outside the branch it already contains.',
        )
      }
      seen.add(cursor)
      chain.push(cursor)
      cursor = parentOf.get(cursor) ?? null
    }

    // A chain that ran out of parents ends above the roots, at -1.
    let level = cursor !== null ? levelOf.get(cursor)! : -1
    for (const node of chain.reverse()) {
      level += 1
      levelOf.set(node, level)
    }
    return levelOf.get(id)!
  }

  for (const row of graph.rows) {
    if (resolveLevel(row.id) > MAX_CATEGORY_DEPTH - 1) throw tooDeep(row.name)
  }

  const buckets = new Map<string | null, string[]>()
  for (const row of graph.rows) {
    const parentId = parentOf.get(row.id) ?? null
    const bucket = buckets.get(parentId)
    if (bucket) bucket.push(row.id)
    else buckets.set(parentId, [row.id])
  }

  const updates: Prisma.PrismaPromise<unknown>[] = []

  for (const [parentId, ids] of buckets) {
    const ordered = [...ids].sort((a, b) => {
      const left = requested.get(a) ?? graph.byId.get(a)!.position
      const right = requested.get(b) ?? graph.byId.get(b)!.position
      if (left !== right) return left - right
      // A node that was just dropped wins the tie — it landed there on purpose,
      // and the sibling it landed on gets pushed down.
      if (requested.has(a) !== requested.has(b)) return requested.has(a) ? -1 : 1
      return graph.byId.get(a)!.name.localeCompare(graph.byId.get(b)!.name)
    })

    ordered.forEach((id, index) => {
      const row = graph.byId.get(id)!
      const level = levelOf.get(id)!
      if (row.parentId === parentId && row.position === index && row.level === level) return
      updates.push(
        prisma.category.update({ where: { id }, data: { parentId, position: index, level } }),
      )
    })
  }

  // Every row moves or none does: a partial apply leaves duplicate positions
  // and a tree that reshuffles itself on the next read.
  if (updates.length > 0) await prisma.$transaction(updates)

  return findTree()
}
