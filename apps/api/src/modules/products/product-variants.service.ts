import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest, notFound, unprocessable } from '../../lib/errors.js'
import { slugify } from '../../lib/slug.js'
import type {
  BulkVariantInput,
  CreateVariantInput,
  GenerateVariantsInput,
  UpdateVariantInput,
} from '../../schemas/admin/product.schema.js'
import { setStockTo } from '../inventory/inventory.service.js'
import {
  assertProductExists,
  loadProductDetail,
  variantInclude,
  type ProductDetailRecord,
  type VariantRecord,
} from './products.repository.js'

/**
 * Three options is where a variant grid stops being readable, and the
 * combination count stops being something an operator meant. Colour × Size ×
 * Width at ten values each is a thousand SKUs nobody typed a price for.
 */
const MAX_COMBINATIONS = 250

// ─── stock ───────────────────────────────────────────────────────────────────
//
// Opening stock only. A variant needs a quantity the moment it is created, and
// that write goes through the inventory module like every other one: row
// locked, delta derived from what the lock read, matching
// `inventory_transactions` row in the same transaction.
//
// Changing stock afterwards is not this module's job. It happens through
// adjust or restock, which require a reason — a number that moved with no
// entry explaining it is exactly what the ledger exists to prevent.

// ─── SKUs ────────────────────────────────────────────────────────────────────

/** Uppercase, one separator run, nothing the unique index or a barcode scanner would trip on. */
function normalizeSku(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
}

/**
 * `{brand}-{color}-{size}` → `NIKE-BLACK-9`. Tokens are the brand, the title,
 * and one per option slug. An unknown token renders as nothing rather than
 * being left in the SKU, so a typo produces a short SKU instead of one with a
 * literal `{colour}` in it.
 */
function renderSku(pattern: string, tokens: Record<string, string>): string {
  return normalizeSku(
    pattern.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, name: string) => tokens[name.toLowerCase()] ?? ''),
  )
}

function nextFreeSku(base: string, taken: ReadonlySet<string>): string {
  const candidate = base || 'SKU'
  if (!taken.has(candidate)) return candidate
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const next = `${candidate}-${suffix}`.slice(0, 64)
    if (!taken.has(next)) return next
  }
  return `${candidate}-${Date.now()}`.slice(0, 64)
}

// ─── reads ───────────────────────────────────────────────────────────────────

export async function findMany(productId: string): Promise<VariantRecord[]> {
  await assertProductExists(productId)
  return prisma.productVariant.findMany({
    where: { productId },
    include: variantInclude,
    orderBy: { position: 'asc' },
  })
}

async function findOrThrow(productId: string, variantId: string): Promise<VariantRecord> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: variantInclude,
  })
  if (!variant || variant.productId !== productId) throw notFound('Variant')
  return variant
}

export function findById(productId: string, variantId: string): Promise<VariantRecord> {
  return findOrThrow(productId, variantId)
}

async function nextPosition(productId: string): Promise<number> {
  const last = await prisma.productVariant.findFirst({
    where: { productId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  return (last?.position ?? -1) + 1
}

/**
 * The identity of a variant is the set of option values it carries, not its
 * SKU — which is why generate can be additive. Sorted so that Black/9 and 9/Black
 * are recognised as the same combination whatever order they arrived in.
 */
const combinationKey = (optionValueIds: readonly string[]) => [...optionValueIds].sort().join('|')

/** Every value the product's options offer, indexed for validation and SKU tokens. */
function optionValueIndex(product: ProductDetailRecord) {
  const values = new Map<
    string,
    { id: string; value: string; slug: string; variantOptionId: string; optionSlug: string; position: number }
  >()

  for (const row of product.variantOptions) {
    for (const value of row.variantOption.values) {
      values.set(value.id, {
        id: value.id,
        value: value.value,
        slug: value.slug,
        variantOptionId: row.variantOptionId,
        optionSlug: row.variantOption.slug,
        position: row.position,
      })
    }
  }

  return values
}

// ─── single-variant writes ───────────────────────────────────────────────────

export async function create(
  productId: string,
  input: CreateVariantInput,
  userId?: string,
): Promise<VariantRecord> {
  const product = await loadProductDetail(productId)
  const values = optionValueIndex(product)

  for (const valueId of input.optionValueIds) {
    if (!values.has(valueId)) {
      throw badRequest('That option value is not one this product uses', {
        optionValueIds: 'Re-pick the options for this variant.',
      })
    }
  }

  // One value per option, and one per option the product declares. A variant
  // missing a size is a variant the storefront's picker can never resolve to.
  const usedOptions = new Set(input.optionValueIds.map((id) => values.get(id)!.variantOptionId))
  if (usedOptions.size !== input.optionValueIds.length) {
    throw badRequest('A variant can hold one value per option', {
      optionValueIds: 'Two values from the same option were sent.',
    })
  }
  if (input.optionValueIds.length !== product.variantOptions.length) {
    throw badRequest('This variant does not cover every option', {
      optionValueIds: `Pick one value for each of the ${product.variantOptions.length} options this product uses.`,
    })
  }

  const key = combinationKey(input.optionValueIds)
  const clash = product.variants.find(
    (variant) => combinationKey(variant.optionAssignments.map((row) => row.optionValueId)) === key,
  )
  if (clash) {
    throw unprocessable(
      `${clash.sku} already covers that combination`,
      'Edit that variant instead, or pick a combination that does not exist yet.',
    )
  }

  const sku = input.sku ?? (await deriveSku(product, input.optionValueIds, values))
  const position = await nextPosition(productId)

  const created = await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku,
        barcode: input.barcode ?? null,
        price: input.price,
        compareAtPrice: input.compareAtPrice ?? null,
        mediaId: input.mediaId ?? null,
        status: input.status,
        position,
      },
    })

    if (input.optionValueIds.length > 0) {
      await tx.variantOptionAssignment.createMany({
        data: input.optionValueIds.map((optionValueId) => ({
          variantId: variant.id,
          optionValueId,
        })),
      })
    }

    await tx.inventory.create({
      data: {
        variantId: variant.id,
        quantity: 0,
        ...(input.lowStockThreshold !== undefined
          ? { lowStockThreshold: input.lowStockThreshold }
          : {}),
      },
    })
    if (input.quantity) {
      await setStockTo(tx, variant.id, input.quantity, {
        type: 'ADJUSTMENT',
        referenceType: 'variant.create',
        referenceId: variant.id,
        note: 'Opening stock',
        userId,
      })
    }

    return variant
  })

  return findOrThrow(productId, created.id)
}

/** The SKU a combination wants, before uniqueness is settled. Pure. */
function skuBase(
  product: ProductDetailRecord,
  optionValueIds: readonly string[],
  values: ReturnType<typeof optionValueIndex>,
  pattern?: string | null,
): string {
  const selected = optionValueIds
    .map((id) => values.get(id)!)
    .sort((a, b) => a.position - b.position)

  const tokens: Record<string, string> = {
    brand: product.brand ? slugify(product.brand.name) : '',
    title: slugify(product.title),
    product: slugify(product.title),
  }
  for (const value of selected) tokens[value.optionSlug] = value.slug

  return pattern
    ? renderSku(pattern, tokens)
    : normalizeSku([tokens.brand || tokens.title, ...selected.map((value) => value.slug)].join('-'))
}

/** Every stored SKU that could collide with one of `bases`, in one query. */
async function loadTakenSkus(bases: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(bases)].filter(Boolean)
  if (unique.length === 0) return new Set()

  const rows = await prisma.productVariant.findMany({
    where: { OR: unique.map((base) => ({ sku: { startsWith: base } })) },
    select: { sku: true },
  })
  return new Set(rows.map((row) => row.sku))
}

async function deriveSku(
  product: ProductDetailRecord,
  optionValueIds: readonly string[],
  values: ReturnType<typeof optionValueIndex>,
): Promise<string> {
  const base = skuBase(product, optionValueIds, values)
  return nextFreeSku(base, await loadTakenSkus([base]))
}

export async function update(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
  // Accepted for signature parity with the stock-moving writes; nothing here
  // touches a quantity, so there is no ledger entry to attribute.
  _userId?: string,
): Promise<VariantRecord> {
  // Ownership check: a variant of another product is a 404 on this URL.
  await findOrThrow(productId, variantId)

  if (input.mediaId) {
    const media = await prisma.productMedia.findUnique({
      where: { id: input.mediaId },
      select: { productId: true },
    })
    if (!media || media.productId !== productId) {
      throw badRequest('That image does not belong to this product', {
        mediaId: 'Pick an image from this product’s gallery.',
      })
    }
  }

  const data: Prisma.ProductVariantUpdateInput = {}
  if (input.sku !== undefined) data.sku = input.sku
  if (input.barcode !== undefined) data.barcode = input.barcode
  if (input.price !== undefined) data.price = input.price
  if (input.compareAtPrice !== undefined) data.compareAtPrice = input.compareAtPrice
  if (input.status !== undefined) data.status = input.status
  if (input.mediaId !== undefined) {
    data.media = input.mediaId ? { connect: { id: input.mediaId } } : { disconnect: true }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) await tx.productVariant.update({ where: { id: variantId }, data })

    if (input.lowStockThreshold !== undefined) {
      await tx.inventory.upsert({
        where: { variantId },
        create: { variantId, lowStockThreshold: input.lowStockThreshold },
        update: { lowStockThreshold: input.lowStockThreshold },
      })
    }
  })

  return findOrThrow(productId, variantId)
}

/**
 * The spreadsheet save. One request for the whole edited grid, in one
 * transaction — a partial apply would leave half the column at the new price
 * and give the operator no way to tell which half.
 */
export async function bulkUpdate(
  productId: string,
  input: BulkVariantInput,
  // As in `update` above: thresholds only, so no attribution is lost.
  _userId?: string,
): Promise<VariantRecord[]> {
  await assertProductExists(productId)

  const ids = input.variants.map((row) => row.id)
  const owned = await prisma.productVariant.findMany({
    where: { id: { in: ids }, productId },
    select: { id: true },
  })
  if (owned.length !== new Set(ids).size) {
    throw notFound('Variant')
  }
  await prisma.$transaction(async (tx) => {
    for (const row of input.variants) {
      const data: Prisma.ProductVariantUpdateInput = {}
      if (row.sku !== undefined) data.sku = row.sku
      if (row.barcode !== undefined) data.barcode = row.barcode
      if (row.price !== undefined) data.price = row.price
      if (row.compareAtPrice !== undefined) data.compareAtPrice = row.compareAtPrice
      if (row.status !== undefined) data.status = row.status
      if (row.mediaId !== undefined) {
        data.media = row.mediaId ? { connect: { id: row.mediaId } } : { disconnect: true }
      }
      if (Object.keys(data).length > 0) {
        await tx.productVariant.update({ where: { id: row.id }, data })
      }

      if (row.lowStockThreshold !== undefined) {
        await tx.inventory.upsert({
          where: { variantId: row.id },
          create: { variantId: row.id, lowStockThreshold: row.lowStockThreshold },
          update: { lowStockThreshold: row.lowStockThreshold },
        })
      }
    }
  })

  return findMany(productId)
}

export async function remove(productId: string, variantId: string): Promise<void> {
  const variant = await findOrThrow(productId, variantId)

  const ordered = await prisma.orderItem.count({ where: { variantId } })
  if (ordered > 0) {
    throw unprocessable(
      `${variant.sku} appears in ${ordered} ${ordered === 1 ? 'order' : 'orders'}`,
      'Set it to archived instead. Archived variants disappear from the storefront but keep the order history intact.',
    )
  }

  // Assignments and the inventory row cascade from the variant.
  await prisma.productVariant.delete({ where: { id: variantId } })
}

// ─── generate ────────────────────────────────────────────────────────────────

export type GeneratePreviewRow = {
  key: string
  sku: string
  options: { optionName: string; value: string }[]
  isNew: boolean
}

export type GenerateResult = {
  added: number
  kept: number
  removed: number
  preview: GeneratePreviewRow[]
  /** Combinations outside the selection that cannot be removed — they have sold. */
  blocked: { sku: string; reason: string }[]
  applied: boolean
}

/**
 * Additive by design. Existing combinations keep their SKU, their price and
 * their stock; only genuinely new ones are created. That is the difference
 * between adding Red to a live product and re-pricing the six variants that
 * were already selling.
 *
 * `dryRun` is the normal first call: the editor shows "adds 3 · keeps 6 ·
 * removes 0" and only commits on confirm, because finding out afterwards that
 * six rows were removed is how a morning's work disappears.
 */
export async function generate(
  productId: string,
  input: GenerateVariantsInput,
  userId?: string,
): Promise<GenerateResult> {
  const product = await loadProductDetail(productId)
  const values = optionValueIndex(product)

  const declared = new Map(product.variantOptions.map((row) => [row.variantOptionId, row]))

  // Every option in the request has to be one the product actually declares —
  // otherwise the generated variants would carry values for a column the grid
  // has no header for.
  for (const option of input.options) {
    const row = declared.get(option.variantOptionId)
    if (!row) {
      throw badRequest('That option is not one this product uses', {
        options: 'Add the option to the product first, then generate.',
      })
    }
    for (const valueId of option.valueIds) {
      const value = values.get(valueId)
      if (!value || value.variantOptionId !== option.variantOptionId) {
        throw badRequest(`That value does not belong to ${row.variantOption.name}`, {
          options: `Re-pick the values for ${row.variantOption.name}.`,
        })
      }
    }
  }
  if (input.options.length !== product.variantOptions.length) {
    throw badRequest('Every option needs at least one value', {
      options: `This product uses ${product.variantOptions.length} options. Pick values for all of them.`,
    })
  }

  // Cartesian product, in the product's own option order so the grid reads
  // Black/8, Black/9, Black/10, White/8 rather than an arbitrary shuffle.
  const ordered = [...input.options].sort(
    (a, b) => declared.get(a.variantOptionId)!.position - declared.get(b.variantOptionId)!.position,
  )

  const total = ordered.reduce((count, option) => count * option.valueIds.length, 1)
  if (total > MAX_COMBINATIONS) {
    throw unprocessable(
      `That would generate ${total} variants`,
      `${MAX_COMBINATIONS} is the most this grid stays usable at. Narrow the values, or split the product.`,
    )
  }

  let combinations: string[][] = [[]]
  for (const option of ordered) {
    combinations = combinations.flatMap((combination) =>
      option.valueIds.map((valueId) => [...combination, valueId]),
    )
  }

  const existingByKey = new Map(
    product.variants.map((variant) => [
      combinationKey(variant.optionAssignments.map((row) => row.optionValueId)),
      variant,
    ]),
  )
  const desiredKeys = new Set(combinations.map(combinationKey))

  const fresh = combinations.filter((combination) => !existingByKey.has(combinationKey(combination)))

  // One query for every SKU that could collide, rather than one per new
  // combination. `taken` then grows as this run hands SKUs out, because two new
  // combinations can render to the same base and only the index would catch it.
  const taken = await loadTakenSkus(
    fresh.map((combination) => skuBase(product, combination, values, input.defaults.skuPattern)),
  )

  const preview: GeneratePreviewRow[] = []
  const toCreate: { key: string; sku: string; optionValueIds: string[] }[] = []

  for (const combination of combinations) {
    const key = combinationKey(combination)
    const labels = combination.map((valueId) => {
      const value = values.get(valueId)!
      return { optionName: declared.get(value.variantOptionId)!.variantOption.name, value: value.value }
    })

    const existing = existingByKey.get(key)
    if (existing) {
      preview.push({ key, sku: existing.sku, options: labels, isNew: false })
      continue
    }

    const sku = nextFreeSku(
      skuBase(product, combination, values, input.defaults.skuPattern),
      taken,
    )
    taken.add(sku)
    preview.push({ key, sku, options: labels, isNew: true })
    toCreate.push({ key, sku, optionValueIds: combination })
  }

  const stale = product.variants.filter(
    (variant) =>
      !desiredKeys.has(combinationKey(variant.optionAssignments.map((row) => row.optionValueId))),
  )

  const soldVariantIds = stale.length
    ? (
        await prisma.orderItem.groupBy({
          by: ['variantId'],
          where: { variantId: { in: stale.map((variant) => variant.id) } },
        })
      ).map((row) => row.variantId)
    : []

  const blocked = stale
    .filter((variant) => soldVariantIds.includes(variant.id))
    .map((variant) => ({ sku: variant.sku, reason: 'appears in an order' }))

  const removable = stale.filter((variant) => !soldVariantIds.includes(variant.id))
  const willRemove = input.removeUnselected ? removable : []

  const result: GenerateResult = {
    added: toCreate.length,
    kept: preview.length - toCreate.length,
    removed: willRemove.length,
    preview,
    blocked,
    applied: false,
  }

  if (input.dryRun) return result

  await prisma.$transaction(async (tx) => {
    if (willRemove.length > 0) {
      await tx.productVariant.deleteMany({ where: { id: { in: willRemove.map((row) => row.id) } } })
    }

    for (const row of toCreate) {
      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku: row.sku,
          price: input.defaults.price,
          compareAtPrice: input.defaults.compareAtPrice ?? null,
          status: 'ACTIVE',
          position: 0,
        },
      })
      await tx.variantOptionAssignment.createMany({
        data: row.optionValueIds.map((optionValueId) => ({ variantId: variant.id, optionValueId })),
      })
      await tx.inventory.create({ data: { variantId: variant.id, quantity: 0 } })
      if (input.defaults.quantity > 0) {
        await setStockTo(tx, variant.id, input.defaults.quantity, {
          type: 'ADJUSTMENT',
          referenceType: 'variant.generate',
          referenceId: productId,
          note: 'Opening stock from generate',
          userId,
        })
      }
    }

    // Re-sequence the whole grid into the cartesian order. New rows appended at
    // the end would interleave Red between Black and White on the next
    // generate, and a grid whose row order changes per save is unreadable.
    const settled = await tx.productVariant.findMany({
      where: { productId },
      include: { optionAssignments: { select: { optionValueId: true } } },
    })
    const orderByKey = new Map(combinations.map((combination, index) => [combinationKey(combination), index]))

    for (const variant of settled) {
      const key = combinationKey(variant.optionAssignments.map((row) => row.optionValueId))
      // Anything outside the selection that survived (because it has sold)
      // sorts after everything that was asked for, rather than disappearing.
      const position = orderByKey.get(key) ?? combinations.length
      if (variant.position !== position) {
        await tx.productVariant.update({ where: { id: variant.id }, data: { position } })
      }
    }
  })

  return { ...result, applied: true }
}
