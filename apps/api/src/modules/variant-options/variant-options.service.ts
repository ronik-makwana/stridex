import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { resolveSlug } from '../../lib/entity-slug.js'
import type {
  CreateVariantOptionInput,
  CreateVariantOptionValueInput,
  UpdateVariantOptionInput,
  UpdateVariantOptionValueInput,
  VariantOptionListQuery,
} from '../../schemas/admin/variant-option.schema.js'

/**
 * Unlike attributes, both counts come straight from `_count`. Neither join can
 * hold a duplicate: `product_variant_options` is unique(product, option) and
 * `variant_option_assignments` is keyed on (variant, value).
 */
const withCounts = {
  _count: { select: { values: true, productVariantOptions: true } },
} satisfies Prisma.VariantOptionInclude

const valueWithCount = {
  _count: { select: { assignments: true } },
} satisfies Prisma.VariantOptionValueInclude

export type VariantOptionRecord = Prisma.VariantOptionGetPayload<{ include: typeof withCounts }>

export type VariantOptionValueRecord = Prisma.VariantOptionValueGetPayload<{
  include: typeof valueWithCount
}>

/** Query sort keys → columns. Keeps snake_case out of the Prisma call. */
const SORT_COLUMNS = {
  name: 'name',
  position: 'position',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
} as const satisfies Record<string, keyof Prisma.VariantOptionOrderByWithRelationInput>

const optionSlugLookup = {
  findBySlug: (slug: string) =>
    prisma.variantOption.findUnique({ where: { slug }, select: { id: true } }),
  findByPrefix: (base: string) =>
    prisma.variantOption.findMany({
      where: { slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
}

/**
 * Slugs on values are unique per option, not globally: Colour and Size can both
 * have a 'black'. Both lookups are therefore scoped to the parent.
 */
const valueSlugLookup = (variantOptionId: string) => ({
  findBySlug: (slug: string) =>
    prisma.variantOptionValue.findUnique({
      where: { variantOptionId_slug: { variantOptionId, slug } },
      select: { id: true },
    }),
  findByPrefix: (base: string) =>
    prisma.variantOptionValue.findMany({
      where: { variantOptionId, slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
})

function buildWhere(query: VariantOptionListQuery): Prisma.VariantOptionWhereInput {
  if (!query.q) return {}
  return {
    OR: [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ],
  }
}

export async function findMany(query: VariantOptionListQuery) {
  const where = buildWhere(query)
  const orderBy: Prisma.VariantOptionOrderByWithRelationInput[] = [
    { [SORT_COLUMNS[query.sort.field]]: query.sort.direction },
  ]
  // Any non-unique sort needs a tiebreaker, or page 2 can repeat a row from
  // page 1 when several options share a value — `position` especially.
  if (query.sort.field !== 'name') orderBy.push({ name: 'asc' })

  const [data, total] = await prisma.$transaction([
    prisma.variantOption.findMany({
      where,
      include: withCounts,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.variantOption.count({ where }),
  ])

  // Opt-in, for the same reason as attributes: the list screen renders counts,
  // and only the product editor needs the values themselves.
  if (!query.withValues) return { data, total }

  const values = await prisma.variantOptionValue.findMany({
    where: { variantOptionId: { in: data.map((row) => row.id) } },
    include: valueWithCount,
    orderBy: [{ position: 'asc' }, { value: 'asc' }],
  })

  return {
    data: data.map((row) => ({
      ...row,
      values: values.filter((value) => value.variantOptionId === row.id),
    })),
    total,
  }
}

/** The list row, without values. Used wherever a write needs to answer with one. */
async function loadSummary(id: string): Promise<VariantOptionRecord> {
  const option = await prisma.variantOption.findUnique({ where: { id }, include: withCounts })
  if (!option) throw notFound('Variant option')
  return option
}

export async function findById(id: string) {
  const option = await loadSummary(id)
  return { ...option, values: await findValues(id) }
}

export function findValues(variantOptionId: string): Promise<VariantOptionValueRecord[]> {
  return prisma.variantOptionValue.findMany({
    where: { variantOptionId },
    include: valueWithCount,
    orderBy: [{ position: 'asc' }, { value: 'asc' }],
  })
}

/** New rows land at the end of whatever order the operator has already set. */
async function nextPosition(variantOptionId?: string): Promise<number> {
  const last = variantOptionId
    ? await prisma.variantOptionValue.findFirst({
        where: { variantOptionId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
    : await prisma.variantOption.findFirst({
        orderBy: { position: 'desc' },
        select: { position: true },
      })
  return (last?.position ?? -1) + 1
}

export async function create(input: CreateVariantOptionInput): Promise<VariantOptionRecord> {
  const slug = await resolveSlug({
    name: input.name,
    explicit: input.slug,
    lookup: optionSlugLookup,
  })

  return prisma.variantOption.create({
    data: { name: input.name, slug, position: await nextPosition() },
    include: withCounts,
  })
}

export async function update(
  id: string,
  input: UpdateVariantOptionInput,
): Promise<VariantOptionRecord> {
  const existing = await loadSummary(id)

  const data: Prisma.VariantOptionUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.name ?? existing.name,
      explicit: input.slug,
      excludeId: id,
      lookup: optionSlugLookup,
    })
  }

  return prisma.variantOption.update({ where: { id }, data, include: withCounts })
}

/**
 * `product_variant_options.variant_option_id` is `onDelete: Restrict`, so the
 * database would refuse this anyway — as an opaque foreign key error. Counting
 * first turns it into a 422 the dialog can explain.
 */
export async function remove(id: string): Promise<void> {
  const option = await loadSummary(id)
  const used = option._count.productVariantOptions

  if (used > 0) {
    throw unprocessable(
      `${option.name} is used by ${used} ${used === 1 ? 'product' : 'products'}`,
      'Remove it from those products first. Their variants are built on its values.',
    )
  }

  // Values cascade, and no variant can reference one — a variant only exists
  // under a product, and no product uses this option.
  await prisma.variantOption.delete({ where: { id } })
}

// ─── values ──────────────────────────────────────────────────────────────────

async function findValueOrThrow(variantOptionId: string, valueId: string) {
  const value = await prisma.variantOptionValue.findUnique({
    where: { id: valueId },
    include: valueWithCount,
  })
  // A value from another option is a 404 here, not a 403: as far as this URL is
  // concerned it does not exist.
  if (!value || value.variantOptionId !== variantOptionId) throw notFound('Value')
  return value
}

export async function createValue(
  variantOptionId: string,
  input: CreateVariantOptionValueInput,
): Promise<VariantOptionValueRecord> {
  await loadSummary(variantOptionId)

  const slug = await resolveSlug({
    name: input.value,
    explicit: input.slug,
    lookup: valueSlugLookup(variantOptionId),
  })

  return prisma.variantOptionValue.create({
    data: {
      variantOptionId,
      value: input.value,
      slug,
      swatchHex: input.swatchHex ?? null,
      position: await nextPosition(variantOptionId),
    },
    include: valueWithCount,
  })
}

export async function updateValue(
  variantOptionId: string,
  valueId: string,
  input: UpdateVariantOptionValueInput,
): Promise<VariantOptionValueRecord> {
  const existing = await findValueOrThrow(variantOptionId, valueId)

  const data: Prisma.VariantOptionValueUpdateInput = {}
  if (input.value !== undefined) data.value = input.value
  // `null` clears the swatch; `undefined` leaves whatever is there.
  if (input.swatchHex !== undefined) data.swatchHex = input.swatchHex
  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.value ?? existing.value,
      explicit: input.slug,
      excludeId: valueId,
      lookup: valueSlugLookup(variantOptionId),
    })
  }

  return prisma.variantOptionValue.update({
    where: { id: valueId },
    data,
    include: valueWithCount,
  })
}

export async function removeValue(variantOptionId: string, valueId: string): Promise<void> {
  const value = await findValueOrThrow(variantOptionId, valueId)
  const used = value._count.assignments

  if (used > 0) {
    throw unprocessable(
      `${value.value} is used by ${used} ${used === 1 ? 'variant' : 'variants'}`,
      'Delete or regenerate those variants first.',
    )
  }

  await prisma.variantOptionValue.delete({ where: { id: valueId } })
}

/**
 * Positions are rewritten from the array index in one transaction. A partial
 * apply would leave duplicate positions and a list that reorders itself on the
 * next read, so every row moves or none does.
 */
export async function reorderValues(variantOptionId: string, ids: string[]): Promise<void> {
  const existing = await prisma.variantOptionValue.findMany({
    where: { variantOptionId },
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
      prisma.variantOptionValue.update({ where: { id }, data: { position: index } }),
    ),
  )
}
