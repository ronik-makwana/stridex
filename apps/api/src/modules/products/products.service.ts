import { Prisma, type EntityStatus } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest, notFound, unprocessable } from '../../lib/errors.js'
import { resolveSlug } from '../../lib/entity-slug.js'
import { copyObjectByUrl, removeObjectByUrl } from '../../config/minio.js'
import type {
  BulkProductInput,
  CreateProductInput,
  DuplicateProductInput,
  ProductAttributeInput,
  ProductListQuery,
  UpdateProductInput,
} from '../../schemas/admin/product.schema.js'
import {
  brandSelect,
  categorySelect,
  loadCategoryAncestors,
  loadCategorySubtreeIds,
  loadProductDetail,
  loadStockTotals,
  productDetailInclude,
  type CategoryRef,
  type ProductDetailRecord,
} from './products.repository.js'

const productSlugLookup = {
  findBySlug: (slug: string) => prisma.product.findUnique({ where: { slug }, select: { id: true } }),
  findByPrefix: (base: string) =>
    prisma.product.findMany({
      where: { slug: { startsWith: base } },
      select: { id: true, slug: true },
    }),
}

// ─── list ────────────────────────────────────────────────────────────────────

/** Query sort keys → columns. Validated by the Zod enum before it reaches here. */
const SORT_COLUMNS = {
  title: 'p.title',
  status: 'p.status',
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
} as const

/**
 * The list is the one query in the module that drops to SQL, and the stock
 * filter is why. "Out of stock" means summed `quantity - reserved_quantity`
 * across a product's variants, and Prisma's filter language cannot subtract one
 * column from another — so the choice is arithmetic in SQL, or a fetch-then-
 * filter that breaks pagination the moment the table grows.
 *
 * It returns ids only. Hydration goes back through Prisma with the shared
 * include, so exactly one place decides what a product payload contains.
 */
async function findMatchingIds(query: ProductListQuery) {
  const conditions: Prisma.Sql[] = []

  if (query.status) {
    conditions.push(Prisma.sql`p.status = CAST(${query.status} AS "EntityStatus")`)
  }
  if (query.brandId) conditions.push(Prisma.sql`p.brand_id = CAST(${query.brandId} AS uuid)`)

  if (query.categoryId) {
    // Filtering by 'Men' has to include 'Men > Running', or a branch holding
    // hundreds of products reports zero.
    const scope = await loadCategorySubtreeIds(query.categoryId)
    conditions.push(
      Prisma.sql`p.category_id IN (${Prisma.join(scope.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})`,
    )
  }

  if (query.q) {
    // Title is trigram-indexed, so is variant SKU. Operators paste a SKU off a
    // packing slip about as often as they type half a product name.
    const like = `%${query.q}%`
    conditions.push(Prisma.sql`(
      p.title ILIKE ${like}
      OR p.slug ILIKE ${like}
      OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.sku ILIKE ${like})
    )`)
  }

  if (query.missingMedia !== undefined) {
    const clause = Prisma.sql`EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id)`
    conditions.push(query.missingMedia ? Prisma.sql`NOT ${clause}` : clause)
  }

  if (query.stock === 'in') conditions.push(Prisma.sql`COALESCE(vs.has_stock, FALSE)`)
  if (query.stock === 'out') conditions.push(Prisma.sql`NOT COALESCE(vs.has_stock, FALSE)`)
  if (query.stock === 'low') conditions.push(Prisma.sql`COALESCE(vs.has_low, FALSE)`)

  const where =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty

  // Archived variants are excluded from the buckets: a product whose only
  // stocked variant was archived is out of stock, whatever the row still says.
  const stockCte = query.stock
    ? Prisma.sql`WITH variant_stock AS (
        SELECT pv.product_id,
               BOOL_OR(COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0) > 0) AS has_stock,
               BOOL_OR(
                 COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0) > 0
                 AND COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0)
                     <= COALESCE(i.low_stock_threshold, 0)
               ) AS has_low
        FROM product_variants pv
        LEFT JOIN inventories i ON i.variant_id = pv.id
        WHERE pv.status <> 'ARCHIVED'
        GROUP BY pv.product_id
      )`
    : Prisma.empty

  const stockJoin = query.stock
    ? Prisma.sql`LEFT JOIN variant_stock vs ON vs.product_id = p.id`
    : Prisma.empty

  // `id` is the tiebreaker on every sort: without it page 2 can repeat a row
  // from page 1 whenever several products share a title or a timestamp.
  const orderBy = Prisma.raw(
    `${SORT_COLUMNS[query.sort.field]} ${query.sort.direction === 'desc' ? 'DESC' : 'ASC'}, p.id ASC`,
  )

  const rows = await prisma.$queryRaw<{ id: string; total: number }[]>`
    ${stockCte}
    SELECT p.id, (COUNT(*) OVER())::int AS total
    FROM products p
    ${stockJoin}
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
  `

  return { ids: rows.map((row) => row.id), total: rows[0]?.total ?? 0 }
}

export type ProductSummary = Awaited<ReturnType<typeof findMany>>['data'][number]

export async function findMany(query: ProductListQuery) {
  const { ids, total } = await findMatchingIds(query)
  if (ids.length === 0) return { data: [], total }

  const [rows, stock] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        brand: { select: brandSelect },
        category: { select: categorySelect },
        // The cover only. A list row shows one thumbnail, and loading the whole
        // gallery for 25 rows is 200 rows nobody renders.
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        _count: { select: { variants: true, media: true } },
      },
    }),
    loadStockTotals(ids),
  ])

  const ancestors = await loadCategoryAncestors(rows.map((row) => row.categoryId))

  // `IN (...)` does not preserve order, and the SQL above is where the sort
  // was decided — so the page is put back into the order it was asked for.
  const byId = new Map(rows.map((row) => [row.id, row]))
  const data = ids.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    const { media, _count, ...product } = row
    return [
      {
        ...product,
        coverUrl: media[0]?.url ?? null,
        mediaCount: _count.media,
        variantCount: _count.variants,
        totalStock: stock.get(id) ?? 0,
        categoryAncestors: ancestors.get(row.categoryId ?? '') ?? ([] as CategoryRef[]),
      },
    ]
  })

  return { data, total }
}

export type ProductDetail = ProductDetailRecord & {
  totalStock: number
  variantCount: number
  mediaCount: number
  categoryAncestors: CategoryRef[]
}

/**
 * The complete payload, and the only thing any write answers with. Returning
 * the bare record instead would hand the editor a product whose `totalStock`
 * reads 0 — not because it has none, but because nobody summed it — and that
 * number goes straight into the list cache.
 */
export async function findById(id: string): Promise<ProductDetail> {
  const product = await loadProductDetail(id)
  const [stock, ancestors] = await Promise.all([
    loadStockTotals([id]),
    loadCategoryAncestors([product.categoryId]),
  ])

  return {
    ...product,
    totalStock: stock.get(id) ?? 0,
    variantCount: product.variants.length,
    mediaCount: product.media.length,
    categoryAncestors: ancestors.get(product.categoryId ?? '') ?? ([] as CategoryRef[]),
  }
}

// ─── attributes: validating a submitted list against its definitions ─────────

type ResolvedAttributeRow = {
  attributeId: string
  attributeValueId: string | null
  valueText: string | null
  valueNumber: string | null
  valueBoolean: boolean | null
}

const DECIMAL_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/

/**
 * Which column holds the value is decided by the attribute's own type, which
 * only the database knows — so the request shape is permissive and the
 * mismatches are caught here, named after the attribute the operator can see on
 * screen rather than after a column they cannot.
 *
 * Also enforces one row per attribute for everything except MULTI_SELECT. The
 * unique index cannot: `unique(product, attribute, attribute_value_id)` lets
 * two rows through when the third column is NULL, which is every non-select type.
 */
async function resolveAttributeRows(
  rows: ProductAttributeInput[],
): Promise<ResolvedAttributeRow[]> {
  if (rows.length === 0) return []

  const attributeIds = [...new Set(rows.map((row) => row.attributeId))]
  const attributes = await prisma.attribute.findMany({
    where: { id: { in: attributeIds } },
    include: { values: { select: { id: true } } },
  })

  const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const missing = attributeIds.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    throw badRequest('That attribute no longer exists', {
      attributes: 'One of the attributes on this form has been deleted. Remove the row and save again.',
    })
  }

  const seen = new Map<string, number>()
  const resolved: ResolvedAttributeRow[] = []

  for (const row of rows) {
    const attribute = byId.get(row.attributeId)!
    const count = (seen.get(row.attributeId) ?? 0) + 1
    seen.set(row.attributeId, count)

    if (count > 1 && attribute.type !== 'MULTI_SELECT') {
      throw badRequest(`${attribute.name} is set twice`, {
        attributes: `${attribute.name} holds one value. Remove the duplicate row.`,
      })
    }

    const empty: ResolvedAttributeRow = {
      attributeId: attribute.id,
      attributeValueId: null,
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
    }

    switch (attribute.type) {
      case 'SELECT':
      case 'MULTI_SELECT': {
        if (!row.attributeValueId) {
          throw badRequest(`${attribute.name} has no value`, {
            attributes: `Choose a value for ${attribute.name}, or remove the row.`,
          })
        }
        if (!attribute.values.some((value) => value.id === row.attributeValueId)) {
          throw badRequest(`That value does not belong to ${attribute.name}`, {
            attributes: `Re-pick the value for ${attribute.name}.`,
          })
        }
        resolved.push({ ...empty, attributeValueId: row.attributeValueId })
        break
      }
      case 'TEXT': {
        const text = row.valueText?.trim()
        if (!text) {
          throw badRequest(`${attribute.name} has no value`, {
            attributes: `Type a value for ${attribute.name}, or remove the row.`,
          })
        }
        resolved.push({ ...empty, valueText: text })
        break
      }
      case 'NUMBER': {
        const raw = typeof row.valueNumber === 'number' ? String(row.valueNumber) : row.valueNumber?.trim()
        if (!raw) {
          throw badRequest(`${attribute.name} has no value`, {
            attributes: `Enter a number for ${attribute.name}, or remove the row.`,
          })
        }
        if (!DECIMAL_PATTERN.test(raw)) {
          throw badRequest(`${attribute.name} is not a number`, {
            attributes: `${attribute.name} takes a number with at most two decimal places.`,
          })
        }
        resolved.push({ ...empty, valueNumber: Number(raw).toFixed(2) })
        break
      }
      case 'BOOLEAN': {
        if (typeof row.valueBoolean !== 'boolean') {
          throw badRequest(`${attribute.name} has no value`, {
            attributes: `Choose yes or no for ${attribute.name}, or remove the row.`,
          })
        }
        resolved.push({ ...empty, valueBoolean: row.valueBoolean })
        break
      }
    }
  }

  return resolved
}

const attributeKey = (row: { attributeId: string; attributeValueId: string | null }) =>
  `${row.attributeId}:${row.attributeValueId ?? ''}`

/**
 * Applies a whole-list replacement as inserts, updates and deletes. Rows that
 * survive keep their id — and so their `position` — because the alternative,
 * delete-all-then-insert, renumbers every row on every save and makes the
 * editor's drag order meaningless.
 */
async function syncAttributes(
  tx: Prisma.TransactionClient,
  productId: string,
  rows: ResolvedAttributeRow[],
) {
  const existing = await tx.productAttribute.findMany({ where: { productId } })
  const existingByKey = new Map(existing.map((row) => [attributeKey(row), row]))
  const nextKeys = new Set(rows.map(attributeKey))

  const stale = existing.filter((row) => !nextKeys.has(attributeKey(row)))
  if (stale.length > 0) {
    await tx.productAttribute.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
  }

  for (const [index, row] of rows.entries()) {
    const match = existingByKey.get(attributeKey(row))
    if (match) {
      await tx.productAttribute.update({
        where: { id: match.id },
        data: { ...row, position: index },
      })
    } else {
      await tx.productAttribute.create({ data: { ...row, productId, position: index } })
    }
  }
}

/**
 * Options are positional: `position` drives the Option 1 / Option 2 labels, the
 * SKU token order and the storefront's picker order, so the array index is the
 * whole payload.
 *
 * Removing an option a product already has variants on is refused rather than
 * cascaded. `variant_option_assignments` would survive the delete and every
 * variant would silently keep an assignment to an option the product no longer
 * declares — a grid with a column that is not there.
 */
async function syncVariantOptions(
  tx: Prisma.TransactionClient,
  productId: string,
  variantOptionIds: string[],
) {
  const existing = await tx.productVariantOption.findMany({ where: { productId } })
  const next = new Set(variantOptionIds)
  const removed = existing.filter((row) => !next.has(row.variantOptionId))

  if (removed.length > 0) {
    const variantCount = await tx.productVariant.count({ where: { productId } })
    if (variantCount > 0) {
      const names = await tx.variantOption.findMany({
        where: { id: { in: removed.map((row) => row.variantOptionId) } },
        select: { name: true },
      })
      throw unprocessable(
        `${names.map((row) => row.name).join(' and ')} cannot be removed while this product has variants`,
        'Delete the variants built on it first, then remove the option and generate again.',
      )
    }
    await tx.productVariantOption.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } })
  }

  for (const [index, variantOptionId] of variantOptionIds.entries()) {
    const match = existing.find((row) => row.variantOptionId === variantOptionId)
    if (match) {
      if (match.position !== index) {
        await tx.productVariantOption.update({ where: { id: match.id }, data: { position: index } })
      }
    } else {
      await tx.productVariantOption.create({ data: { productId, variantOptionId, position: index } })
    }
  }
}

// ─── writes ──────────────────────────────────────────────────────────────────

export async function create(input: CreateProductInput): Promise<ProductDetail> {
  const slug = await resolveSlug({
    name: input.title,
    explicit: input.slug,
    lookup: productSlugLookup,
  })
  const attributes = await resolveAttributeRows(input.attributes ?? [])

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        title: input.title,
        slug,
        description: input.description ?? null,
        brandId: input.brandId ?? null,
        categoryId: input.categoryId ?? null,
        status: input.status,
        // Set the moment it first goes live, and never cleared afterwards:
        // 'first published' is a different fact from 'currently active'.
        publishedAt: input.status === 'ACTIVE' ? new Date() : null,
      },
    })

    if (attributes.length > 0) await syncAttributes(tx, created.id, attributes)
    if (input.variantOptions?.length) {
      await syncVariantOptions(
        tx,
        created.id,
        input.variantOptions.map((row) => row.variantOptionId),
      )
    }

    return created
  })

  return findById(product.id)
}

export async function update(id: string, input: UpdateProductInput): Promise<ProductDetail> {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) throw notFound('Product')

  const attributes =
    input.attributes !== undefined ? await resolveAttributeRows(input.attributes) : undefined

  const data: Prisma.ProductUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description
  if (input.status !== undefined) {
    data.status = input.status
    if (input.status === 'ACTIVE' && !existing.publishedAt) data.publishedAt = new Date()
  }
  // `null` clears the link; `undefined` leaves whatever is there.
  if (input.brandId !== undefined) {
    data.brand = input.brandId ? { connect: { id: input.brandId } } : { disconnect: true }
  }
  if (input.categoryId !== undefined) {
    data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true }
  }
  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug({
      name: input.title ?? existing.title,
      explicit: input.slug,
      excludeId: id,
      lookup: productSlugLookup,
    })
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) await tx.product.update({ where: { id }, data })
    if (attributes !== undefined) await syncAttributes(tx, id, attributes)
    if (input.variantOptions !== undefined) {
      await syncVariantOptions(tx, id, input.variantOptions.map((row) => row.variantOptionId))
    }
  })

  return findById(id)
}

export async function setStatus(id: string, status: EntityStatus): Promise<ProductDetail> {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) throw notFound('Product')

  await prisma.product.update({
    where: { id },
    data: {
      status,
      ...(status === 'ACTIVE' && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    },
  })
  return findById(id)
}

// ─── publish checklist ───────────────────────────────────────────────────────

export type PublishCheck = { key: string; label: string; passed: boolean; detail?: string }

/**
 * Run on demand for the popover on the Publish button, and again inside
 * `publish()`. The same function both times, so what the operator was shown and
 * what the server enforces cannot drift apart.
 */
export async function publishChecklist(id: string): Promise<PublishCheck[]> {
  const product = await loadProductDetail(id)

  const unpriced = product.variants.filter((variant) => variant.price.lessThanOrEqualTo(0))
  const emptyAttributes = product.attributes.filter(
    (row) =>
      row.attributeValueId === null &&
      row.valueText === null &&
      row.valueNumber === null &&
      row.valueBoolean === null,
  )

  return [
    {
      key: 'media',
      label: 'Has at least one image',
      passed: product.media.length > 0,
      detail: product.media.length > 0 ? undefined : 'A product with no image does not sell.',
    },
    {
      key: 'variants',
      label: 'Has at least one variant',
      passed: product.variants.length > 0,
      detail:
        product.variants.length > 0
          ? undefined
          : 'There is nothing to add to a cart until a variant exists.',
    },
    {
      key: 'pricing',
      label: 'Every variant is priced',
      passed: unpriced.length === 0,
      detail:
        unpriced.length === 0
          ? undefined
          : `${unpriced.map((variant) => variant.sku).join(', ')} ${unpriced.length === 1 ? 'has' : 'have'} no price.`,
    },
    {
      key: 'attributes',
      label: 'No empty attribute rows',
      passed: emptyAttributes.length === 0,
      detail:
        emptyAttributes.length === 0
          ? undefined
          : 'Fill in or remove the attribute rows with no value.',
    },
  ]
}

export async function publish(id: string): Promise<ProductDetail> {
  const checks = await publishChecklist(id)
  const failures = checks.filter((check) => !check.passed)

  if (failures.length > 0) {
    throw unprocessable(
      `This product is not ready to publish — ${failures.length} ${failures.length === 1 ? 'check' : 'checks'} failed`,
      failures.map((check) => check.detail ?? check.label).join(' '),
    )
  }

  return setStatus(id, 'ACTIVE')
}

// ─── duplicate ───────────────────────────────────────────────────────────────

/**
 * A copy, not a reference. Media objects are copied inside object storage —
 * server side, so no bytes travel through Node — rather than pointing both
 * products at the same key: sharing keys means deleting an image from the copy
 * silently breaks the original.
 */
export async function duplicate(
  id: string,
  input: DuplicateProductInput,
  userId?: string,
): Promise<ProductDetail> {
  const source = await loadProductDetail(id)
  const slug = await resolveSlug({ name: input.title, lookup: productSlugLookup })

  const copiedMedia = input.includeMedia
    ? await Promise.all(
        source.media.map(async (media) => ({
          source: media,
          url: (await copyObjectByUrl(media.url, 'products')) ?? media.url,
        })),
      )
    : []

  const newId = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        title: input.title,
        slug,
        description: source.description,
        brandId: source.brandId,
        categoryId: source.categoryId,
        // Always a draft. A duplicate is a starting point, and one that went
        // live on save would put an unfinished listing in front of customers.
        status: 'DRAFT',
      },
    })

    await tx.productAttribute.createMany({
      data: source.attributes.map((row) => ({
        productId: created.id,
        attributeId: row.attributeId,
        attributeValueId: row.attributeValueId,
        valueText: row.valueText,
        valueNumber: row.valueNumber,
        valueBoolean: row.valueBoolean,
        position: row.position,
      })),
    })

    await tx.productVariantOption.createMany({
      data: source.variantOptions.map((row) => ({
        productId: created.id,
        variantOptionId: row.variantOptionId,
        position: row.position,
      })),
    })

    // Old media id → new, so a variant's image survives the copy.
    const mediaIdMap = new Map<string, string>()
    for (const entry of copiedMedia) {
      const media = await tx.productMedia.create({
        data: {
          productId: created.id,
          url: entry.url,
          altText: entry.source.altText,
          type: entry.source.type,
          sortOrder: entry.source.sortOrder,
        },
      })
      mediaIdMap.set(entry.source.id, media.id)
    }

    if (input.includeVariants) {
      // Only the SKUs that could collide with a `-COPY` of one of these, not
      // every SKU in the catalogue.
      const takenSkus = new Set(
        (
          await tx.productVariant.findMany({
            where: { OR: source.variants.map((variant) => ({ sku: { startsWith: variant.sku } })) },
            select: { sku: true },
          })
        ).map((row) => row.sku),
      )

      for (const variant of source.variants) {
        const sku = nextFreeSku(variant.sku, takenSkus)
        takenSkus.add(sku)

        const copy = await tx.productVariant.create({
          data: {
            productId: created.id,
            sku,
            barcode: null, // Barcodes are physical and unique to a real unit.
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            position: variant.position,
            status: variant.status,
            mediaId: variant.mediaId ? (mediaIdMap.get(variant.mediaId) ?? null) : null,
          },
        })

        await tx.variantOptionAssignment.createMany({
          data: variant.optionAssignments.map((assignment) => ({
            variantId: copy.id,
            optionValueId: assignment.optionValueId,
          })),
        })

        const quantity = input.includeInventory ? (variant.inventory?.quantity ?? 0) : 0
        const inventory = await tx.inventory.create({
          data: {
            variantId: copy.id,
            quantity,
            lowStockThreshold: variant.inventory?.lowStockThreshold ?? 5,
          },
        })

        // Copied stock still gets a ledger row. Units that appear with no
        // entry explaining them are exactly what the ledger exists to prevent.
        if (quantity > 0) {
          await tx.inventoryTransaction.create({
            data: {
              inventoryId: inventory.id,
              type: 'ADJUSTMENT',
              quantity,
              referenceType: 'product.duplicate',
              referenceId: source.id,
              note: `Copied from ${source.title} (${variant.sku})`,
              createdByUserId: userId ?? null,
            },
          })
        }
      }
    }

    return created.id
  })

  return findById(newId)
}

/** `NIKE-BLK-9` → `NIKE-BLK-9-COPY`, then `-COPY-2`. SKUs are globally unique. */
function nextFreeSku(base: string, taken: ReadonlySet<string>): string {
  const candidate = `${base}-COPY`.slice(0, 64)
  if (!taken.has(candidate)) return candidate
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const next = `${base}-COPY-${suffix}`.slice(0, 64)
    if (!taken.has(next)) return next
  }
  return `${base}-${Date.now()}`.slice(0, 64)
}

// ─── delete and bulk ─────────────────────────────────────────────────────────

/**
 * Order lines snapshot their own title, SKU, options and price, and
 * `order_items.variant_id` is `SetNull` — so the database would happily let a
 * sold product be deleted and leave the history readable.
 *
 * It is still refused. An order whose lines point at nothing cannot be
 * reconciled against the catalogue, refunded against a real variant, or
 * explained to the customer who bought it. Archive keeps the product out of the
 * storefront and the trail intact, which is what "delete" actually meant.
 */
async function orderedVariantCount(productId: string): Promise<number> {
  return prisma.orderItem.count({ where: { variant: { productId } } })
}

export async function remove(id: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, title: true, media: { select: { url: true } } },
  })
  if (!product) throw notFound('Product')

  const ordered = await orderedVariantCount(id)
  if (ordered > 0) {
    throw unprocessable(
      `${product.title} appears in ${ordered} ${ordered === 1 ? 'order' : 'orders'}`,
      'Archive it instead. Archived products disappear from the storefront but keep the order history intact.',
    )
  }

  // Media, attributes, options, variants and inventory all cascade from the
  // product row. Only the stored objects need sweeping by hand.
  await prisma.product.delete({ where: { id } })
  await Promise.all(product.media.map((media) => removeObjectByUrl(media.url)))
}

export type BulkResult = { updated: number; skipped: { id: string; title: string; reason: string }[] }

/**
 * Partial success by design. Ten products selected and one of them sold is not
 * a reason to refuse the other nine — it is a reason to say which one was
 * skipped and why.
 */
export async function bulk(input: BulkProductInput): Promise<BulkResult> {
  const products = await prisma.product.findMany({
    where: { id: { in: input.ids } },
    select: { id: true, title: true },
  })
  const skipped: BulkResult['skipped'] = []

  if (input.action === 'delete') {
    const ordered = await prisma.orderItem.groupBy({
      by: ['variantId'],
      where: { variant: { productId: { in: input.ids } } },
      _count: true,
    })
    const soldVariantIds = ordered.flatMap((row) => (row.variantId ? [row.variantId] : []))
    const soldProducts = await prisma.productVariant.findMany({
      where: { id: { in: soldVariantIds } },
      select: { productId: true },
    })
    const blocked = new Set(soldProducts.map((row) => row.productId))

    for (const product of products) {
      if (blocked.has(product.id)) {
        skipped.push({ id: product.id, title: product.title, reason: 'appears in an order' })
      }
    }

    const deletable = products.filter((product) => !blocked.has(product.id)).map((row) => row.id)
    if (deletable.length > 0) {
      const media = await prisma.productMedia.findMany({
        where: { productId: { in: deletable } },
        select: { url: true },
      })
      await prisma.product.deleteMany({ where: { id: { in: deletable } } })
      await Promise.all(media.map((row) => removeObjectByUrl(row.url)))
    }
    return { updated: deletable.length, skipped }
  }

  if (input.action === 'setCategory') {
    const result = await prisma.product.updateMany({
      where: { id: { in: input.ids } },
      data: { categoryId: input.categoryId ?? null },
    })
    return { updated: result.count, skipped }
  }

  // Publishing in bulk still runs the checklist per product: a bulk action is a
  // shortcut, not a way around the rules a single publish has to satisfy.
  if (input.action === 'publish') {
    let updated = 0
    for (const product of products) {
      const failures = (await publishChecklist(product.id)).filter((check) => !check.passed)
      if (failures.length > 0) {
        skipped.push({
          id: product.id,
          title: product.title,
          reason: failures.map((check) => check.label.toLowerCase()).join(', '),
        })
        continue
      }
      await setStatus(product.id, 'ACTIVE')
      updated += 1
    }
    return { updated, skipped }
  }

  const status: EntityStatus = input.action === 'archive' ? 'ARCHIVED' : 'DRAFT'
  const result = await prisma.product.updateMany({
    where: { id: { in: input.ids } },
    data: { status },
  })
  return { updated: result.count, skipped }
}

export { productDetailInclude }
