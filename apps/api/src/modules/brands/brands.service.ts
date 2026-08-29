import type { EntityStatus, Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js'
import { slugify, uniqueSlug } from '../../lib/slug.js'
import { removeObjectByUrl } from '../../config/minio.js'
import type {
  BrandListQuery,
  CreateBrandInput,
  UpdateBrandInput,
} from '../../schemas/admin/brand.schema.js'

/** Product counts ride along on every read: the UI gates delete on them. */
const withProductCount = { _count: { select: { products: true } } } satisfies Prisma.BrandInclude

export type BrandRecord = Prisma.BrandGetPayload<{ include: typeof withProductCount }>

/** Query sort keys → columns. Keeps snake_case out of the Prisma call. */
const SORT_COLUMNS = {
  name: 'name',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  status: 'status',
} as const satisfies Record<string, keyof Prisma.BrandOrderByWithRelationInput>

function buildWhere(query: BrandListQuery): Prisma.BrandWhereInput {
  const where: Prisma.BrandWhereInput = {}
  if (query.status) where.status = query.status
  if (query.q) {
    // Name is trigram-indexed; slug is short and unique-indexed. Both are
    // searched because operators paste slugs in as often as they type names.
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ]
  }
  return where
}

export async function findMany(query: BrandListQuery) {
  const where = buildWhere(query)
  const orderBy: Prisma.BrandOrderByWithRelationInput[] = [
    { [SORT_COLUMNS[query.sort.field]]: query.sort.direction },
  ]
  // Any non-unique sort needs a tiebreaker, or page 2 can repeat a row from
  // page 1 when several brands share a value.
  if (query.sort.field !== 'name') orderBy.push({ name: 'asc' })

  const [data, total] = await prisma.$transaction([
    prisma.brand.findMany({
      where,
      include: withProductCount,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.brand.count({ where }),
  ])

  return { data, total }
}

export async function findById(id: string): Promise<BrandRecord> {
  const brand = await prisma.brand.findUnique({ where: { id }, include: withProductCount })
  if (!brand) throw notFound('Brand')
  return brand
}

/**
 * An explicit slug is honoured verbatim — a 409 if taken, so the operator can
 * see and fix it. A derived one is quietly disambiguated, because nobody typed
 * it and a failed create there is a dead end.
 */
async function resolveSlug(
  name: string,
  explicit: string | undefined,
  excludeId?: string,
): Promise<string> {
  if (explicit) {
    const clash = await prisma.brand.findUnique({ where: { slug: explicit }, select: { id: true } })
    if (clash && clash.id !== excludeId) {
      throw conflict('That slug is already in use', { slug: 'Already in use' })
    }
    return explicit
  }

  const base = slugify(name)
  if (!base) {
    throw badRequest('Could not build a slug from that name', {
      slug: 'Enter a slug — the name has no letters or digits to derive one from',
    })
  }

  const neighbours = await prisma.brand.findMany({
    where: { slug: { startsWith: base } },
    select: { id: true, slug: true },
  })
  return uniqueSlug(
    base,
    neighbours.filter((row) => row.id !== excludeId).map((row) => row.slug),
  )
}

export async function create(input: CreateBrandInput): Promise<BrandRecord> {
  const slug = await resolveSlug(input.name, input.slug)

  return prisma.brand.create({
    data: {
      name: input.name,
      slug,
      logoUrl: input.logoUrl ?? null,
      status: input.status,
    },
    include: withProductCount,
  })
}

export async function update(id: string, input: UpdateBrandInput): Promise<BrandRecord> {
  const existing = await findById(id)

  const data: Prisma.BrandUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.status !== undefined) data.status = input.status
  // `null` clears the logo; `undefined` leaves whatever is there.
  if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl
  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug(input.name ?? existing.name, input.slug, id)
  }

  const updated = await prisma.brand.update({ where: { id }, data, include: withProductCount })

  // A replaced or cleared logo leaves its old object unreferenced. Only ours
  // are touched — `removeObjectByUrl` ignores anything outside the bucket.
  if (input.logoUrl !== undefined && existing.logoUrl !== updated.logoUrl) {
    await removeObjectByUrl(existing.logoUrl)
  }

  return updated
}

export async function setStatus(id: string, status: EntityStatus): Promise<BrandRecord> {
  await findById(id)
  return prisma.brand.update({ where: { id }, data: { status }, include: withProductCount })
}

/**
 * `products.brand_id` is `onDelete: Restrict`, so the database would refuse
 * this anyway — as an opaque foreign key error. Counting first turns it into a
 * 422 the dialog can explain and offer "Set to draft" against.
 */
export async function remove(id: string): Promise<void> {
  const brand = await findById(id)

  if (brand._count.products > 0) {
    const count = brand._count.products
    throw unprocessable(
      `${brand.name} still has ${count} ${count === 1 ? 'product' : 'products'}`,
      'Move or delete those products first, or set the brand to draft to hide it from the storefront.',
    )
  }

  await prisma.brand.delete({ where: { id } })
  await removeObjectByUrl(brand.logoUrl)
}
