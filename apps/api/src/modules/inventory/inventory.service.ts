import { Prisma, type InventoryTransactionType } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound, unprocessable } from '../../lib/errors.js'
import {
  ADJUST_REASONS,
  type AdjustStockInput,
  type InventoryListQuery,
  type LowStockQuery,
  type RestockInput,
  type TransactionListQuery,
} from '../../schemas/admin/inventory.schema.js'

// ─── the one way stock is ever written ───────────────────────────────────────

export type StockMove = {
  variantId: string
  /** Signed. Negative removes units. */
  delta: number
  type: InventoryTransactionType
  /** Machine token naming the source — 'adjust:damaged', 'restock', 'order'. */
  referenceType: string
  referenceId?: string | null
  note?: string | null
  /** Null for moves the system makes: checkout, webhooks. */
  userId?: string | null
}

/**
 * Applies one stock move inside a caller-supplied transaction: lock the row,
 * compute from what the lock read, write the new quantity, write the matching
 * ledger entry. Never call `inventory.update` anywhere else.
 *
 * The lock is the point. Two admins saving at once, or a checkout racing an
 * adjustment, would otherwise both read 20, both write their own answer, and
 * leave a ledger whose rows do not add up to the number on the inventory row.
 * At that moment the ledger stops being evidence and becomes decoration.
 *
 * Returns the settled quantities so callers can report them without a re-read.
 */
export async function applyStockMove(
  tx: Prisma.TransactionClient,
  move: StockMove,
): Promise<{ inventoryId: string; quantity: number; reserved: number }> {
  // SELECT ... FOR UPDATE. Prisma has no first-class row lock, so this is raw —
  // and it has to be, because `findUnique` would let the second writer through.
  const locked = await tx.$queryRaw<
    { id: string; quantity: number; reserved_quantity: number }[]
  >`
    SELECT id, quantity, reserved_quantity
    FROM inventories
    WHERE variant_id = CAST(${move.variantId} AS uuid)
    FOR UPDATE
  `

  let row = locked[0]
  if (!row) {
    // A variant with no inventory row is a gap phases 4 and 5 should not leave,
    // but a missing row must not make stock unwritable.
    const created = await tx.inventory.create({
      data: { variantId: move.variantId, quantity: 0 },
      select: { id: true, quantity: true, reservedQuantity: true },
    })
    row = { id: created.id, quantity: created.quantity, reserved_quantity: created.reservedQuantity }
  }

  const quantity = row.quantity + move.delta

  if (quantity < 0) {
    throw unprocessable(
      `That would leave ${quantity} on hand`,
      `There are ${row.quantity} units on hand. Stock cannot go below zero.`,
    )
  }
  // Reserved units are already promised to a pending order. Letting on hand
  // fall below them means a customer who has paid cannot be shipped, and the
  // shortfall surfaces at packing rather than here.
  if (quantity < row.reserved_quantity) {
    throw unprocessable(
      `${quantity} is fewer than the ${row.reserved_quantity} units pending orders are holding`,
      'Cancel or fulfil those orders first, or adjust to at least the reserved quantity.',
    )
  }

  await tx.inventory.update({ where: { id: row.id }, data: { quantity } })
  await tx.inventoryTransaction.create({
    data: {
      inventoryId: row.id,
      type: move.type,
      quantity: move.delta,
      referenceType: move.referenceType,
      referenceId: move.referenceId ?? null,
      note: move.note ?? null,
      createdByUserId: move.userId ?? null,
    },
  })

  return { inventoryId: row.id, quantity, reserved: row.reserved_quantity }
}

/**
 * The same move when the caller has no transaction of its own. Anything that
 * also touches other tables must open one and use `applyStockMove` directly, or
 * the two writes can end up on opposite sides of a failure.
 */
export function commitStockMove(move: StockMove) {
  return prisma.$transaction((tx) => applyStockMove(tx, move))
}

/**
 * Absolute form, for the screens that edit the number rather than a change to
 * it — opening stock on a new variant, a set-to adjustment.
 *
 * The delta is derived from what the lock reads, never from what the client was
 * shown. Someone typing 20 against a screen that has since gone to 18 means
 * "make it 20", and the ledger row has to say +2 for the entries to still sum
 * to the row. Returns null when the number is already right, so a no-op save
 * does not leave a 0-unit entry in the ledger.
 */
export async function setStockTo(
  tx: Prisma.TransactionClient,
  variantId: string,
  target: number,
  move: Omit<StockMove, 'variantId' | 'delta'>,
) {
  const locked = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT quantity FROM inventories WHERE variant_id = CAST(${variantId} AS uuid) FOR UPDATE
  `
  const delta = target - (locked[0]?.quantity ?? 0)
  if (delta === 0) return null

  return applyStockMove(tx, { ...move, variantId, delta })
}

// ─── reads ───────────────────────────────────────────────────────────────────

const rowInclude = {
  inventory: true,
  product: { include: { brand: { select: { id: true, name: true, slug: true } } } },
  optionAssignments: { include: { optionValue: true } },
} satisfies Prisma.ProductVariantInclude

export type InventoryRowRecord = Prisma.ProductVariantGetPayload<{ include: typeof rowInclude }>

/** Query sort keys → columns. Validated by the Zod enum before it reaches here. */
const SORT_COLUMNS = {
  sku: 'pv.sku',
  product: 'p.title',
  on_hand: 'COALESCE(i.quantity, 0)',
  reserved: 'COALESCE(i.reserved_quantity, 0)',
  available: 'COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0)',
  updated_at: 'COALESCE(i.updated_at, pv.updated_at)',
} as const

/**
 * SQL for the same reason the product list is: available is
 * `quantity - reserved_quantity`, and this screen both filters and sorts on it.
 * Prisma cannot subtract one column from another in a filter, and doing it in
 * Node means fetching the table to sort a page of it.
 *
 * Returns ids only; hydration goes back through Prisma.
 */
async function findMatchingVariantIds(query: InventoryListQuery, thresholdOverride?: number) {
  const conditions: Prisma.Sql[] = [
    // Archived variants are not stock anyone can sell. They stay in the ledger,
    // but they do not belong in a list whose purpose is deciding what to order.
    Prisma.sql`pv.status <> 'ARCHIVED'`,
  ]

  if (query.brandId) conditions.push(Prisma.sql`p.brand_id = CAST(${query.brandId} AS uuid)`)
  if (query.categoryId) conditions.push(Prisma.sql`p.category_id = CAST(${query.categoryId} AS uuid)`)

  if (query.q) {
    const like = `%${query.q}%`
    conditions.push(Prisma.sql`(pv.sku ILIKE ${like} OR p.title ILIKE ${like})`)
  }

  const available = Prisma.sql`(COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0))`
  // The override answers "show me everything under 10" regardless of what was
  // configured per SKU; without it each variant is judged against its own.
  const threshold =
    thresholdOverride === undefined
      ? Prisma.sql`COALESCE(i.low_stock_threshold, 0)`
      : Prisma.sql`${thresholdOverride}`

  if (query.stock === 'out') conditions.push(Prisma.sql`${available} <= 0`)
  if (query.stock === 'in') conditions.push(Prisma.sql`${available} > 0`)
  if (query.stock === 'low') {
    conditions.push(Prisma.sql`${available} > 0 AND ${available} <= ${threshold}`)
  }

  const orderBy = Prisma.raw(
    `${SORT_COLUMNS[query.sort.field]} ${query.sort.direction === 'desc' ? 'DESC' : 'ASC'}, pv.sku ASC`,
  )

  const rows = await prisma.$queryRaw<{ id: string; total: number }[]>`
    SELECT pv.id, (COUNT(*) OVER())::int AS total
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN inventories i ON i.variant_id = pv.id
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY ${orderBy}
    LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
  `

  return { ids: rows.map((row) => row.id), total: rows[0]?.total ?? 0 }
}

export async function findMany(query: InventoryListQuery, thresholdOverride?: number) {
  const { ids, total } = await findMatchingVariantIds(query, thresholdOverride)
  if (ids.length === 0) return { data: [], total }

  const rows = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    include: rowInclude,
  })

  // `IN (...)` does not preserve order, and the SQL above is where the sort was
  // decided — so the page is put back into the order it was asked for.
  const byId = new Map(rows.map((row) => [row.id, row]))
  return { data: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), total }
}

export function findLowStock(query: LowStockQuery) {
  return findMany({ ...query, stock: 'low' }, query.threshold)
}

export async function findByVariantId(variantId: string): Promise<InventoryRowRecord> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: rowInclude,
  })
  if (!variant) throw notFound('Variant')
  return variant
}

// ─── the ledger ──────────────────────────────────────────────────────────────

const transactionInclude = {
  createdBy: { select: { id: true, email: true, firstName: true, lastName: true } },
  inventory: { include: { variant: { include: rowInclude } } },
} satisfies Prisma.InventoryTransactionInclude

export type TransactionRecord = Prisma.InventoryTransactionGetPayload<{
  include: typeof transactionInclude
}>

function buildTransactionWhere(query: TransactionListQuery): Prisma.InventoryTransactionWhereInput {
  const where: Prisma.InventoryTransactionWhereInput = {}

  if (query.type) where.type = query.type

  // Both filters reach the same relation, so they are collected before being
  // assigned — writing `where.inventory` twice would drop the first one.
  const inventory: Prisma.InventoryWhereInput = {}
  if (query.variantId) inventory.variantId = query.variantId
  if (query.q) {
    inventory.variant = {
      OR: [
        { sku: { contains: query.q, mode: 'insensitive' } },
        { product: { title: { contains: query.q, mode: 'insensitive' } } },
      ],
    }
  }
  if (Object.keys(inventory).length > 0) where.inventory = { is: inventory }

  if (query.from || query.to) {
    where.createdAt = {}
    if (query.from) where.createdAt.gte = query.from
    if (query.to) {
      // A date input sends midnight. Treating `to` as exclusive would make
      // "29 Aug to 29 Aug" return nothing, so the whole day is included.
      const end = new Date(query.to)
      end.setHours(23, 59, 59, 999)
      where.createdAt.lte = end
    }
  }

  return where
}

export async function findTransactions(query: TransactionListQuery) {
  const where = buildTransactionWhere(query)

  const [data, total] = await prisma.$transaction([
    prisma.inventoryTransaction.findMany({
      where,
      include: transactionInclude,
      // Newest first, id as the tiebreaker: several rows of one adjustment can
      // share a timestamp to the millisecond, and a ledger that reorders itself
      // between page loads is not a ledger.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.inventoryTransaction.count({ where }),
  ])

  return { data, total }
}

export async function findVariantTransactions(variantId: string, query: TransactionListQuery) {
  await findByVariantId(variantId)
  return findTransactions({ ...query, variantId })
}

// ─── writes ──────────────────────────────────────────────────────────────────

export async function adjust(
  variantId: string,
  input: AdjustStockInput,
  userId?: string,
): Promise<InventoryRowRecord> {
  const variant = await findByVariantId(variantId)
  const reason = ADJUST_REASONS[input.reason]

  const move = {
    type: reason.type as InventoryTransactionType,
    referenceType: `adjust:${input.reason}`,
    note: input.note,
    userId,
  }

  await prisma.$transaction(async (tx) => {
    const applied =
      input.mode === 'set'
        ? await setStockTo(tx, variantId, input.value, move)
        : await applyStockMove(tx, { ...move, variantId, delta: input.value })

    // Only `set` can be a no-op — `change` rejects 0 at the schema. Saying so
    // beats a success toast for something that did nothing.
    if (!applied) {
      throw unprocessable(
        'That leaves the stock exactly as it is',
        `There ${variant.inventory?.quantity === 1 ? 'is' : 'are'} already ${variant.inventory?.quantity ?? 0} on hand.`,
      )
    }
  })

  return findByVariantId(variant.id)
}

export async function restock(
  variantId: string,
  input: RestockInput,
  userId?: string,
): Promise<InventoryRowRecord> {
  await findByVariantId(variantId)

  await commitStockMove({
    variantId,
    delta: input.quantity,
    type: 'RESTOCK',
    referenceType: 'restock',
    // The purchase order names something outside this system, and there is no
    // column for it — `reference_id` is a uuid pointing at our own tables. It
    // leads the note instead, which is where the same person reads it anyway.
    note: [input.reference, input.note].filter(Boolean).join(' — ') || null,
    userId,
  })

  return findByVariantId(variantId)
}

/** The low-stock threshold is configuration, not stock: no lock, no ledger row. */
export async function setThreshold(
  variantId: string,
  lowStockThreshold: number,
): Promise<InventoryRowRecord> {
  await findByVariantId(variantId)
  await prisma.inventory.upsert({
    where: { variantId },
    create: { variantId, lowStockThreshold },
    update: { lowStockThreshold },
  })
  return findByVariantId(variantId)
}
