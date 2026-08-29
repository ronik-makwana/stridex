import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { resolveSlug } from '../../lib/entity-slug.js'
import { isListType } from '../../schemas/admin/attribute.schema.js'
import type {
  AttributeListQuery,
  CreateAttributeInput,
  CreateAttributeValueInput,
  UpdateAttributeInput,
  UpdateAttributeValueInput,
} from '../../schemas/admin/attribute.schema.js'

const withValueCount = { _count: { select: { values: true } } } satisfies Prisma.AttributeInclude

/** Every read path attaches the counts, so they are required rather than optional. */
export type AttributeRecord = Prisma.AttributeGetPayload<{ include: typeof withValueCount }> & {
  productCount: number
}

export type AttributeValueRecord = Prisma.AttributeValueGetPayload<object> & {
  productCount: number
}

/** Query sort keys → columns. Keeps snake_case out of the Prisma call. */
const SORT_COLUMNS = {
  name: 'name',
  type: 'type',
  position: 'position',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
} as const satisfies Record<string, keyof Prisma.AttributeOrderByWithRelationInput>

const attributeSlugLookup = {
  findBySlug: (slug: string) =>
    prisma.attribute.findUnique({ where: { slug }, select: { id: true } }),
  findByPrefix: (base: string) =>
    prisma.attribute.findMany({
      where: { slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
}

/**
 * Slugs on values are unique per attribute, not globally: Colour and Material
 * can both have 'black'. Both lookups are therefore scoped to the parent.
 */
const valueSlugLookup = (attributeId: string) => ({
  findBySlug: (slug: string) =>
    prisma.attributeValue.findUnique({
      where: { attributeId_slug: { attributeId, slug } },
      select: { id: true },
    }),
  findByPrefix: (base: string) =>
    prisma.attributeValue.findMany({
      where: { attributeId, slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
})

// ─── product counts ──────────────────────────────────────────────────────────
//
// A MULTI_SELECT attribute writes one `product_attributes` row per selected
// value, so `_count` would report one product as three. Prisma's groupBy cannot
// express COUNT(DISTINCT), hence the raw queries. Both are keyed on indexed
// columns and run once per page, not once per row.

async function productCountsByAttribute(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()

  const rows = await prisma.$queryRaw<{ attribute_id: string; count: number }[]>`
    SELECT attribute_id, COUNT(DISTINCT product_id)::int AS count
    FROM product_attributes
    WHERE attribute_id = ANY(${ids}::uuid[])
    GROUP BY attribute_id
  `
  return new Map(rows.map((row) => [row.attribute_id, row.count]))
}

async function productCountsByValue(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()

  const rows = await prisma.$queryRaw<{ attribute_value_id: string; count: number }[]>`
    SELECT attribute_value_id, COUNT(DISTINCT product_id)::int AS count
    FROM product_attributes
    WHERE attribute_value_id = ANY(${ids}::uuid[])
    GROUP BY attribute_value_id
  `
  return new Map(rows.map((row) => [row.attribute_value_id, row.count]))
}

function buildWhere(query: AttributeListQuery): Prisma.AttributeWhereInput {
  const where: Prisma.AttributeWhereInput = {}
  if (query.type) where.type = query.type
  if (query.isFilterable !== undefined) where.isFilterable = query.isFilterable
  if (query.q) {
    // Operators paste slugs in as often as they type names.
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ]
  }
  return where
}

export async function findMany(query: AttributeListQuery) {
  const where = buildWhere(query)
  const orderBy: Prisma.AttributeOrderByWithRelationInput[] = [
    { [SORT_COLUMNS[query.sort.field]]: query.sort.direction },
  ]
  // Any non-unique sort needs a tiebreaker, or page 2 can repeat a row from
  // page 1 when several attributes share a value.
  if (query.sort.field !== 'name') orderBy.push({ name: 'asc' })

  const [data, total] = await prisma.$transaction([
    prisma.attribute.findMany({
      where,
      include: withValueCount,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.attribute.count({ where }),
  ])

  const counts = await productCountsByAttribute(data.map((row) => row.id))

  return {
    data: data.map((row) => ({ ...row, productCount: counts.get(row.id) ?? 0 })),
    total,
  }
}

/** The list row, without values. Used wherever a write needs to answer with one. */
async function loadSummary(id: string): Promise<AttributeRecord> {
  const attribute = await prisma.attribute.findUnique({ where: { id }, include: withValueCount })
  if (!attribute) throw notFound('Attribute')

  const counts = await productCountsByAttribute([id])
  return { ...attribute, productCount: counts.get(id) ?? 0 }
}

export async function findById(id: string) {
  const attribute = await loadSummary(id)
  return { ...attribute, values: await findValues(id) }
}

export async function findValues(attributeId: string): Promise<AttributeValueRecord[]> {
  const values = await prisma.attributeValue.findMany({
    where: { attributeId },
    orderBy: [{ position: 'asc' }, { value: 'asc' }],
  })

  const counts = await productCountsByValue(values.map((value) => value.id))
  return values.map((value) => ({ ...value, productCount: counts.get(value.id) ?? 0 }))
}

/** New rows land at the end of whatever order the operator has already set. */
async function nextPosition(attributeId?: string): Promise<number> {
  const last = attributeId
    ? await prisma.attributeValue.findFirst({
        where: { attributeId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
    : await prisma.attribute.findFirst({
        orderBy: { position: 'desc' },
        select: { position: true },
      })
  return (last?.position ?? -1) + 1
}

export async function create(input: CreateAttributeInput): Promise<AttributeRecord> {
  const slug = await resolveSlug({
    name: input.name,
    explicit: input.slug,
    lookup: attributeSlugLookup,
  })

  const attribute = await prisma.attribute.create({
    data: {
      name: input.name,
      slug,
      type: input.type,
      // A unit only means anything on a number. Storing 'mm' against a SELECT
      // would render as "Leather mm" the first time someone forgets.
      unit: input.type === 'NUMBER' ? input.unit : null,
      isFilterable: input.isFilterable,
      isSuggested: input.isSuggested,
      position: await nextPosition(),
    },
    include: withValueCount,
  })

  return { ...attribute, productCount: 0 }
}

export async function update(id: string, input: UpdateAttributeInput): Promise<AttributeRecord> {
  const existing = await loadSummary(id)

  const data: Prisma.AttributeUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.isFilterable !== undefined) data.isFilterable = input.isFilterable
  if (input.isSuggested !== undefined) data.isSuggested = input.isSuggested

  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.name ?? existing.name,
      explicit: input.slug,
      excludeId: id,
      lookup: attributeSlugLookup,
    })
  }

  // The type decides which column on `product_attributes` is populated and
  // whether a value list exists at all. Once either has been written against
  // it, a change would strand rows that no longer match their own attribute.
  const nextType = input.type ?? existing.type
  if (input.type !== undefined && input.type !== existing.type) {
    if (existing._count.values > 0) {
      throw unprocessable(
        `${existing.name} has ${existing._count.values} values, so its type cannot change`,
        'Delete the values first, or create a new attribute with the type you want.',
      )
    }
    if (existing.productCount > 0) {
      throw unprocessable(
        `${existing.name} is used by ${existing.productCount} products, so its type cannot change`,
        'Remove it from those products first, or create a new attribute with the type you want.',
      )
    }
    data.type = input.type
  }

  // Unit follows the type it belongs to, whichever of the two just moved.
  if (input.unit !== undefined || data.type !== undefined) {
    data.unit = nextType === 'NUMBER' ? (input.unit ?? existing.unit) : null
  }

  const updated = await prisma.attribute.update({ where: { id }, data, include: withValueCount })
  const counts = await productCountsByAttribute([id])
  return { ...updated, productCount: counts.get(id) ?? 0 }
}

/**
 * `product_attributes.attribute_id` is `onDelete: Restrict`, so the database
 * would refuse this anyway — as an opaque foreign key error. Counting first
 * turns it into a 422 the dialog can explain.
 */
export async function remove(id: string): Promise<void> {
  const attribute = await loadSummary(id)

  if (attribute.productCount > 0) {
    const count = attribute.productCount
    throw unprocessable(
      `${attribute.name} is used by ${count} ${count === 1 ? 'product' : 'products'}`,
      'Remove it from those products first. Deleting it would drop the values they hold.',
    )
  }

  // Values cascade, and nothing else references an attribute.
  await prisma.attribute.delete({ where: { id } })
}

// ─── values ──────────────────────────────────────────────────────────────────

/** Rejects the whole idea of a value list on a type that cannot hold one. */
async function requireListType(id: string): Promise<AttributeRecord> {
  const attribute = await loadSummary(id)
  if (!isListType(attribute.type)) {
    throw unprocessable(
      `${attribute.name} is a ${attribute.type} attribute and has no value list`,
      'Only SELECT and MULTI_SELECT attributes hold values. The value is stored on the product itself.',
    )
  }
  return attribute
}

async function findValueOrThrow(attributeId: string, valueId: string) {
  const value = await prisma.attributeValue.findUnique({ where: { id: valueId } })
  // A value from another attribute is a 404 here, not a 403: as far as this
  // URL is concerned it does not exist.
  if (!value || value.attributeId !== attributeId) throw notFound('Value')
  return value
}

export async function createValue(
  attributeId: string,
  input: CreateAttributeValueInput,
): Promise<AttributeValueRecord> {
  await requireListType(attributeId)

  const slug = await resolveSlug({
    name: input.value,
    explicit: input.slug,
    lookup: valueSlugLookup(attributeId),
  })

  const created = await prisma.attributeValue.create({
    data: {
      attributeId,
      value: input.value,
      slug,
      position: await nextPosition(attributeId),
    },
  })

  return { ...created, productCount: 0 }
}

export async function updateValue(
  attributeId: string,
  valueId: string,
  input: UpdateAttributeValueInput,
): Promise<AttributeValueRecord> {
  const existing = await findValueOrThrow(attributeId, valueId)

  const data: Prisma.AttributeValueUpdateInput = {}
  if (input.value !== undefined) data.value = input.value
  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.value ?? existing.value,
      explicit: input.slug,
      excludeId: valueId,
      lookup: valueSlugLookup(attributeId),
    })
  }

  const updated = await prisma.attributeValue.update({ where: { id: valueId }, data })
  const counts = await productCountsByValue([valueId])
  return { ...updated, productCount: counts.get(valueId) ?? 0 }
}

export async function removeValue(attributeId: string, valueId: string): Promise<void> {
  const value = await findValueOrThrow(attributeId, valueId)

  const counts = await productCountsByValue([valueId])
  const used = counts.get(valueId) ?? 0
  if (used > 0) {
    throw unprocessable(
      `${value.value} is set on ${used} ${used === 1 ? 'product' : 'products'}`,
      'Change those products to another value first.',
    )
  }

  await prisma.attributeValue.delete({ where: { id: valueId } })
}

/**
 * Positions are rewritten from the array index in one transaction. A partial
 * apply would leave duplicate positions and a list that reorders itself on the
 * next read, so every row moves or none does.
 */
export async function reorderValues(attributeId: string, ids: string[]): Promise<void> {
  const existing = await prisma.attributeValue.findMany({
    where: { attributeId },
    select: { id: true },
  })

  const known = new Set(existing.map((row) => row.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw notFound(unknown.length === 1 ? 'Value' : 'Values')
  }
  // A short list would silently renumber the rest to trailing positions. The
  // client always holds the full list, so a partial one is a bug worth naming.
  if (ids.length !== existing.length) {
    throw conflict(
      'That order is out of date — the value list changed while you were dragging',
      { ids: 'Reload and try again' },
    )
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.attributeValue.update({ where: { id }, data: { position: index } }),
    ),
  )
}
