import { Prisma, type EntityStatus } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { AppError, conflict, notFound } from '../../lib/errors.js'
import { resolveSlug } from '../../lib/entity-slug.js'
import { removeObjectByUrl } from '../../config/minio.js'
import type {
  AddProductsInput,
  CollectionListQuery,
  CreateCollectionInput,
  PreviewRulesInput,
  RuleInput,
  UpdateCollectionInput,
} from '../../schemas/admin/collection.schema.js'
import {
  brandSelect,
  categorySelect,
  loadCategoryAncestors,
  loadStockTotals,
} from '../products/products.repository.js'
import { serializeAdminProduct } from '../../serializers/admin/product.serializer.js'
import { buildWhere } from './rules.engine.js'

const collectionSlugLookup = {
  findBySlug: (slug: string) =>
    prisma.collection.findUnique({ where: { slug }, select: { id: true } }),
  findByPrefix: (base: string) =>
    prisma.collection.findMany({
      where: { slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
}

const withRules = {
  rules: { orderBy: [{ groupId: 'asc' }, { createdAt: 'asc' }] },
  _count: { select: { products: true } },
} satisfies Prisma.CollectionInclude

export type CollectionRecord = Prisma.CollectionGetPayload<{ include: typeof withRules }>

/** Query sort keys → columns. Keeps snake_case out of the Prisma call. */
const SORT_COLUMNS = {
  name: 'name',
  type: 'type',
  status: 'status',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
} as const satisfies Record<string, keyof Prisma.CollectionOrderByWithRelationInput>

function buildListWhere(query: CollectionListQuery): Prisma.CollectionWhereInput {
  const where: Prisma.CollectionWhereInput = {}
  if (query.type) where.type = query.type
  if (query.status) where.status = query.status
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ]
  }
  return where
}

const toRuleInputs = (rules: { field: string; operator: string; value: unknown }[]): RuleInput[] =>
  rules.map((rule) => ({
    field: rule.field,
    operator: rule.operator as RuleInput['operator'],
    value: rule.value as RuleInput['value'],
  }))

/**
 * How many products a collection holds right now. Manual is a stored count;
 * dynamic has to run the rules, which is one query per collection — plus the
 * stock rule's aggregate when one is used.
 *
 * That is affordable at this catalogue's size and is the first thing to cache
 * when it stops being. Phase 17 puts dynamic results in Redis, invalidated on
 * publish; until then the number is always live, which is the right trade while
 * the rules are still being tuned.
 *
 * A broken rule resolves to a count of null rather than failing the list — one
 * collection pointing at a deleted brand must not take the whole page down.
 */
async function resolveCount(collection: CollectionRecord): Promise<number | null> {
  if (collection.type === 'MANUAL') return collection._count.products
  try {
    const where = await buildWhere(toRuleInputs(collection.rules), collection.matchType)
    return await prisma.product.count({ where })
  } catch {
    return null
  }
}

export async function findMany(query: CollectionListQuery) {
  const where = buildListWhere(query)
  const orderBy: Prisma.CollectionOrderByWithRelationInput[] = [
    { [SORT_COLUMNS[query.sort.field]]: query.sort.direction },
  ]
  // Any non-unique sort needs a tiebreaker, or page 2 can repeat a row from
  // page 1 when several collections share a value.
  if (query.sort.field !== 'name') orderBy.push({ name: 'asc' })

  const [rows, total] = await prisma.$transaction([
    prisma.collection.findMany({
      where,
      include: withRules,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.collection.count({ where }),
  ])

  const counts = await Promise.all(rows.map(resolveCount))

  return {
    data: rows.map((row, index) => ({
      ...row,
      productCount: counts[index] ?? 0,
      ruleError: counts[index] === null ? 'One of these conditions no longer resolves' : null,
    })),
    total,
  }
}

async function loadOrThrow(id: string): Promise<CollectionRecord> {
  const collection = await prisma.collection.findUnique({ where: { id }, include: withRules })
  if (!collection) throw notFound('Collection')
  return collection
}

export type CollectionDetail = CollectionRecord & {
  productCount: number
  ruleError: string | null
}

/**
 * The complete payload, and the only thing any write answers with. Returning
 * the bare record instead would report a dynamic collection's count as 0 — not
 * because nothing matches, but because nobody ran the rules — and that number
 * goes straight into the list cache.
 */
export async function findById(id: string): Promise<CollectionDetail> {
  const collection = await loadOrThrow(id)
  const count = await resolveCount(collection)

  return {
    ...collection,
    productCount: count ?? 0,
    ruleError: count === null ? 'One of these conditions no longer resolves' : null,
  }
}

// ─── membership ──────────────────────────────────────────────────────────────

const productInclude = {
  brand: { select: brandSelect },
  category: { select: categorySelect },
  media: { orderBy: { sortOrder: 'asc' }, take: 1 },
  _count: { select: { variants: true, media: true } },
} satisfies Prisma.ProductInclude

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>

/** Shared shaping so a collection's products look like a product list row. */
async function serializeProducts(rows: ProductRow[]) {
  const ids = rows.map((row) => row.id)
  const [stock, ancestors] = await Promise.all([
    loadStockTotals(ids),
    loadCategoryAncestors(rows.map((row) => row.categoryId)),
  ])

  return rows.map((row) => {
    const { media, _count, ...product } = row
    return serializeAdminProduct({
      ...product,
      coverUrl: media[0]?.url ?? null,
      mediaCount: _count.media,
      variantCount: _count.variants,
      totalStock: stock.get(row.id) ?? 0,
      categoryAncestors: ancestors.get(row.categoryId ?? '') ?? [],
    })
  })
}

/**
 * The products in a collection, however it decides them. Manual reads the
 * pinned order; dynamic runs the rules. One endpoint either way, because the
 * screen showing them should not have to care.
 */
export async function findProducts(id: string, page: number, limit: number) {
  const collection = await loadOrThrow(id)
  const skip = (page - 1) * limit

  if (collection.type === 'MANUAL') {
    const [links, total] = await prisma.$transaction([
      prisma.collectionProduct.findMany({
        where: { collectionId: id },
        include: { product: { include: productInclude } },
        orderBy: { position: 'asc' },
        skip,
        take: limit,
      }),
      prisma.collectionProduct.count({ where: { collectionId: id } }),
    ])
    return { data: await serializeProducts(links.map((link) => link.product)), total }
  }

  const where = await buildWhere(toRuleInputs(collection.rules), collection.matchType)
  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ])
  return { data: await serializeProducts(rows), total }
}

/**
 * Unsaved by design, so the builder can call it on every edit. Returns the
 * count first and a small sample second — the count is what a merchandiser
 * checks, and the sample is what tells them the rules mean what they think.
 */
export async function preview(input: PreviewRulesInput) {
  const where = await buildWhere(input.rules, input.matchType)

  const [total, rows] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: input.limit,
    }),
  ])

  return { count: total, sample: await serializeProducts(rows) }
}

// ─── writes ──────────────────────────────────────────────────────────────────

/**
 * Rules are replaced wholesale rather than edited one at a time. The builder
 * edits a set — add a condition, change an operator, drop one — and sending the
 * whole set means the server sees a state that was valid together, instead of a
 * half-applied filter left behind by the third request failing.
 */
async function syncRules(tx: Prisma.TransactionClient, collectionId: string, rules: RuleInput[]) {
  await tx.collectionRule.deleteMany({ where: { collectionId } })
  if (rules.length === 0) return

  await tx.collectionRule.createMany({
    data: rules.map((rule) => ({
      collectionId,
      field: rule.field,
      operator: rule.operator,
      value: (rule.value ?? null) as Prisma.InputJsonValue,
      // Flat, one group. `group_id` exists for nested all/any cards; building
      // half of that is worse than leaving it at the default.
      groupId: 0,
    })),
  })
}

/** Rejects before writing, so a rule set that cannot resolve is never stored. */
async function assertRulesResolve(rules: RuleInput[], matchType: 'ALL' | 'ANY') {
  if (rules.length === 0) return
  await buildWhere(rules, matchType)
}

export async function create(input: CreateCollectionInput): Promise<CollectionDetail> {
  const slug = await resolveSlug({
    name: input.name,
    explicit: input.slug,
    lookup: collectionSlugLookup,
  })

  if (input.rules?.length) await assertRulesResolve(input.rules, input.matchType)

  const created = await prisma.$transaction(async (tx) => {
    const collection = await tx.collection.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        type: input.type,
        matchType: input.matchType,
        status: input.status,
      },
    })
    if (input.rules) await syncRules(tx, collection.id, input.rules)
    return collection
  })

  return findById(created.id)
}

export async function update(
  id: string,
  input: UpdateCollectionInput,
): Promise<CollectionDetail> {
  const existing = await loadOrThrow(id)
  const matchType = input.matchType ?? existing.matchType

  if (input.rules?.length) await assertRulesResolve(input.rules, matchType)

  const data: Prisma.CollectionUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl
  if (input.type !== undefined) data.type = input.type
  if (input.matchType !== undefined) data.matchType = input.matchType
  if (input.status !== undefined) data.status = input.status
  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.name ?? existing.name,
      explicit: input.slug,
      excludeId: id,
      lookup: collectionSlugLookup,
    })
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) await tx.collection.update({ where: { id }, data })
    if (input.rules !== undefined) await syncRules(tx, id, input.rules)
  })

  // Switching to MANUAL leaves the rules in place on purpose: flipping the
  // segmented control to compare the two lists is a normal thing to do, and
  // discarding the rules would make it a one-way door.
  const updated = await findById(id)

  if (input.imageUrl !== undefined && existing.imageUrl !== updated.imageUrl) {
    await removeObjectByUrl(existing.imageUrl)
  }

  return updated
}

export async function setStatus(id: string, status: EntityStatus): Promise<CollectionDetail> {
  await loadOrThrow(id)
  await prisma.collection.update({ where: { id }, data: { status } })
  return findById(id)
}

/**
 * Nothing blocks this. A collection is a grouping — deleting one removes an
 * arrangement of products, never a product — so both join tables cascade and
 * there is no 422 path to explain.
 */
export async function remove(id: string): Promise<void> {
  const collection = await loadOrThrow(id)
  await prisma.collection.delete({ where: { id } })
  await removeObjectByUrl(collection.imageUrl)
}

// ─── manual membership ───────────────────────────────────────────────────────

async function assertManual(id: string): Promise<CollectionRecord> {
  const collection = await loadOrThrow(id)
  if (collection.type !== 'MANUAL') {
    throw new AppError(422, 'UNPROCESSABLE', 'This collection picks its products by rules', {
      reason: 'Switch it to manual first, or edit the conditions instead.',
    })
  }
  return collection
}

export async function addProducts(id: string, input: AddProductsInput): Promise<number> {
  await assertManual(id)

  const existing = await prisma.collectionProduct.findMany({
    where: { collectionId: id },
    orderBy: { position: 'desc' },
    take: 1,
    select: { position: true },
  })
  let position = (existing[0]?.position ?? -1) + 1

  // Already-present products are skipped rather than rejected: adding six
  // products of which two are already in is a normal thing to do, and failing
  // the whole request over it would be pedantry.
  const result = await prisma.collectionProduct.createMany({
    data: input.productIds.map((productId) => ({
      collectionId: id,
      productId,
      position: position++,
    })),
    skipDuplicates: true,
  })

  return result.count
}

export async function removeProduct(id: string, productId: string): Promise<void> {
  await assertManual(id)
  const link = await prisma.collectionProduct.findUnique({
    where: { collectionId_productId: { collectionId: id, productId } },
  })
  if (!link) throw notFound('Product in this collection')

  await prisma.$transaction(async (tx) => {
    await tx.collectionProduct.delete({
      where: { collectionId_productId: { collectionId: id, productId } },
    })
    // Close the gap, so positions stay a dense 0..n-1 and the next add lands
    // where the operator expects.
    const remaining = await tx.collectionProduct.findMany({
      where: { collectionId: id },
      orderBy: { position: 'asc' },
      select: { productId: true },
    })
    for (const [index, row] of remaining.entries()) {
      await tx.collectionProduct.update({
        where: { collectionId_productId: { collectionId: id, productId: row.productId } },
        data: { position: index },
      })
    }
  })
}

/**
 * Positions are rewritten from the array index in one transaction. A partial
 * apply would leave duplicate positions and a list that reorders itself on the
 * next read, so every row moves or none does.
 */
export async function reorderProducts(id: string, productIds: string[]): Promise<void> {
  await assertManual(id)

  const existing = await prisma.collectionProduct.findMany({
    where: { collectionId: id },
    select: { productId: true },
  })
  const known = new Set(existing.map((row) => row.productId))
  if (productIds.some((productId) => !known.has(productId))) {
    throw notFound('Product in this collection')
  }
  // The client always holds the full list, so a partial one is a bug worth naming.
  if (productIds.length !== existing.length) {
    throw conflict('That order is out of date — the list changed while you were dragging', {
      ids: 'Reload and try again',
    })
  }

  await prisma.$transaction(
    productIds.map((productId, index) =>
      prisma.collectionProduct.update({
        where: { collectionId_productId: { collectionId: id, productId } },
        data: { position: index },
      }),
    ),
  )
}
