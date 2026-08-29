import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

/**
 * Why a manual stock move happened, and what it becomes in the ledger.
 *
 * `inventory_transactions.type` is a fixed enum, and several distinct reasons
 * collapse onto ADJUSTMENT — damage and a recount are the same kind of row to
 * the database and very different things to whoever reads it back. So the type
 * carries the accounting category and `reference_type` carries the reason
 * token, the same way it already carries `variant.create` and
 * `product.duplicate` on the moves phases 4 and 5 write.
 *
 * SALE and RESERVATION are absent on purpose: those are written by checkout,
 * never by a person, and offering them here would let an operator forge one.
 */
export const ADJUST_REASONS = {
  recount: { type: 'ADJUSTMENT', label: 'Stock count correction' },
  damaged: { type: 'ADJUSTMENT', label: 'Damaged' },
  lost: { type: 'ADJUSTMENT', label: 'Lost or stolen' },
  found: { type: 'ADJUSTMENT', label: 'Found' },
  returned: { type: 'RETURN', label: 'Customer return' },
  released: { type: 'RELEASE', label: 'Released from a cancelled order' },
} as const satisfies Record<string, { type: string; label: string }>

export type AdjustReason = keyof typeof ADJUST_REASONS

export const adjustReasonSchema = z.enum(
  Object.keys(ADJUST_REASONS) as [AdjustReason, ...AdjustReason[]],
  'Choose a reason',
)

export const transactionTypeSchema = z.enum([
  'RESTOCK',
  'SALE',
  'RESERVATION',
  'RELEASE',
  'RETURN',
  'ADJUSTMENT',
])

export const stockFilterSchema = z.enum(['in', 'low', 'out'])

const quantitySchema = z
  .number()
  .int('Whole units only')
  .max(1_000_000, 'That is more stock than this system will hold')

const noteSchema = z
  .string()
  .trim()
  .max(500, 'Use at most 500 characters')
  .nullish()
  .transform((value) => value || null)

export const inventoryListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  brandId: z.uuid('Not a valid id').optional(),
  categoryId: z.uuid('Not a valid id').optional(),
  stock: stockFilterSchema.optional(),
  // Available ascending by default: the rows that cost money are the ones at
  // zero, and a list that opens on them is a list that gets acted on.
  sort: sortSchema(['sku', 'product', 'on_hand', 'reserved', 'available', 'updated_at'], 'available:asc'),
})

/**
 * The low-stock view is the same query with the bucket forced, plus an optional
 * override of each variant's own threshold — "show me everything under 10"
 * regardless of what was configured per SKU.
 */
export const lowStockQuerySchema = inventoryListQuerySchema.extend({
  threshold: z.coerce.number().int().min(0).max(100_000).optional(),
})

export const variantParamSchema = z.object({
  variantId: z.uuid('Not a valid id'),
})

/**
 * `set` writes an absolute number, `change` writes a delta. The two are the
 * classic mix-up — typing 3 meaning "three fewer" and getting three on hand —
 * which is why the client shows a live "new on hand" line and why the mode is
 * explicit rather than inferred from a sign.
 */
export const adjustStockSchema = z
  .object({
    mode: z.enum(['set', 'change'], 'Choose set or change'),
    value: quantitySchema.min(-1_000_000, 'That is more stock than this system will hold'),
    reason: adjustReasonSchema,
    note: noteSchema,
  })
  .refine((input) => input.mode !== 'set' || input.value >= 0, {
    message: 'Stock cannot be set below zero',
    path: ['value'],
  })
  .refine((input) => input.mode !== 'change' || input.value !== 0, {
    message: 'Enter how many units to add or remove',
    path: ['value'],
  })

export const restockSchema = z.object({
  quantity: quantitySchema.min(1, 'Enter how many units arrived'),
  /** A purchase order or delivery note. Free text — it names something external. */
  reference: z.string().trim().max(120, 'Use at most 120 characters').nullish().transform((value) => value || null),
  note: noteSchema,
})

export const transactionListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  type: transactionTypeSchema.optional(),
  variantId: z.uuid('Not a valid id').optional(),
  // Dates arrive as 'YYYY-MM-DD' from a date input. `to` is treated as
  // inclusive by the service, or "29 Aug to 29 Aug" would return nothing.
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>
export type LowStockQuery = z.infer<typeof lowStockQuerySchema>
export type VariantParam = z.infer<typeof variantParamSchema>
export type AdjustStockInput = z.infer<typeof adjustStockSchema>
export type RestockInput = z.infer<typeof restockSchema>
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>
