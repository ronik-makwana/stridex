import { z } from 'zod'
import {
  entityStatusSchema,
  paginationSchema,
  searchSchema,
  slugSchema,
  sortSchema,
} from './common.schema.js'

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(200, 'Use at most 200 characters')

const descriptionSchema = z
  .string()
  .trim()
  .max(20_000, 'That description is too long')
  .nullish()
  .transform((value) => value || null)

/**
 * Money never travels as a float. A price arrives as either a number or the
 * string an input produced, and leaves as a fixed-point string — which is what
 * Prisma wants for `Decimal(12,2)` and what avoids 89.99 becoming 89.98999…
 * somewhere between the form and the ledger.
 */
const moneySchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value.toString() : value.trim()))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), {
    message: 'Enter an amount with at most two decimal places',
  })
  .transform((value) => Number(value).toFixed(2))

/** '' from a cleared compare-at input means "no compare price", not a failure. */
const optionalMoneySchema = moneySchema
  .nullish()
  .or(z.literal('').transform(() => null))

/**
 * SKUs are scanned, pasted into spreadsheets and typed by hand, so they are
 * normalised to one shape on the way in rather than stored however they were
 * typed. Uppercase, no spaces — `nike-blk-9` and `NIKE BLK 9` become the same
 * SKU, which is the point of the unique index.
 */
const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'SKU is required')
  .max(64, 'Use at most 64 characters')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, numbers, dots, dashes and underscores')

const barcodeSchema = z
  .string()
  .trim()
  .max(64, 'Use at most 64 characters')
  .nullish()
  .transform((value) => value || null)

const quantitySchema = z
  .number()
  .int('Whole units only')
  .min(0, 'Cannot be negative')
  .max(1_000_000, 'That is more stock than this system will hold')

/**
 * A tag as it is typed. Tags are free text — created by naming one on a product
 * rather than from a screen of their own — so the only rules are the ones that
 * keep the label readable: no commas, because that is the separator the input
 * splits on, and a length that fits a chip.
 */
const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'A tag needs a name')
  .max(40, 'Use at most 40 characters')
  .refine((value) => !value.includes(','), 'Tags cannot contain commas')

/** Whole-list replacement. The service resolves names to rows and dedupes by slug. */
const tagsSchema = z.array(tagNameSchema).max(30, 'That is more than 30 tags')

/**
 * Manual collections this product belongs to, sent whole. Dynamic collections
 * are refused rather than ignored: membership there is decided by rules, and
 * quietly dropping the id would look like the save worked.
 */
const collectionIdsSchema = z.array(z.uuid('Not a valid id')).max(50, 'That is more than 50 collections')

// ─── products ────────────────────────────────────────────────────────────────

/** The three buckets the stock filter offers. `low` reads the per-variant threshold. */
export const stockFilterSchema = z.enum(['in', 'low', 'out'])

export const productListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  status: entityStatusSchema.optional(),
  brandId: z.uuid('Not a valid id').optional(),
  categoryId: z.uuid('Not a valid id').optional(),
  stock: stockFilterSchema.optional(),
  /** The "Missing images" saved view. Draft products with no cover never sell. */
  missingMedia: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: sortSchema(['title', 'status', 'created_at', 'updated_at'], 'created_at:desc'),
})

/**
 * One attribute row on a product. Which field carries the value is decided by
 * the attribute's own type, which only the server knows — so the shape is
 * permissive here and the service rejects the mismatches with a field error
 * naming the attribute.
 *
 * MULTI_SELECT sends one row per selected value; every other type sends one row.
 */
export const productAttributeInputSchema = z.object({
  attributeId: z.uuid('Not a valid id'),
  attributeValueId: z.uuid('Not a valid id').nullish(),
  valueText: z.string().trim().max(2000).nullish(),
  valueNumber: z.union([z.number(), z.string()]).nullish(),
  valueBoolean: z.boolean().nullish(),
})

/** Position is the array index; `Option 1` / `Option 2` come from it. */
export const productVariantOptionInputSchema = z.object({
  variantOptionId: z.uuid('Not a valid id'),
})

export const createProductSchema = z.object({
  title: titleSchema,
  // Optional: the service derives it from the title when the form leaves it
  // untouched, which is the common path.
  slug: slugSchema.optional(),
  description: descriptionSchema,
  brandId: z.uuid('Not a valid id').nullish(),
  categoryId: z.uuid('Not a valid id').nullish(),
  status: entityStatusSchema.default('DRAFT'),
  attributes: z.array(productAttributeInputSchema).max(60).optional(),
  variantOptions: z.array(productVariantOptionInputSchema).max(3).optional(),
  tags: tagsSchema.optional(),
  collectionIds: collectionIdsSchema.optional(),
})

/**
 * PATCH semantics: absent means "leave it", `null` on a nullable field means
 * "clear it". `attributes` and `variantOptions` are whole-list replacements —
 * send every row every time and the server diffs. Per-row endpoints would mean
 * five round trips for one save and a half-applied form on the third failure.
 */
export const updateProductSchema = z
  .object({
    title: titleSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema,
    brandId: z.uuid('Not a valid id').nullish(),
    categoryId: z.uuid('Not a valid id').nullish(),
    status: entityStatusSchema.optional(),
    attributes: z.array(productAttributeInputSchema).max(60).optional(),
    variantOptions: z.array(productVariantOptionInputSchema).max(3).optional(),
    tags: tagsSchema.optional(),
    collectionIds: collectionIdsSchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export const productStatusSchema = z.object({ status: entityStatusSchema })

export const duplicateProductSchema = z.object({
  title: titleSchema,
  includeMedia: z.boolean().default(true),
  includeVariants: z.boolean().default(true),
  // Off by default: a copy that arrives already in stock is a copy nobody
  // counted, and the ledger would have no idea where the units came from.
  includeInventory: z.boolean().default(false),
})

export const bulkProductSchema = z
  .object({
    ids: z.array(z.uuid('Not a valid id')).min(1, 'Nothing selected').max(200),
    action: z.enum(['publish', 'archive', 'draft', 'delete', 'setCategory']),
    categoryId: z.uuid('Not a valid id').nullish(),
  })
  .refine((value) => value.action !== 'setCategory' || value.categoryId !== undefined, {
    message: 'Choose a category',
    path: ['categoryId'],
  })

// ─── media ───────────────────────────────────────────────────────────────────

export const mediaTypeSchema = z.enum(['IMAGE', 'VIDEO'])

/** Mirrors the upload module's list. Video lands with product media, not logos. */
export const ACCEPTED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
] as const

export const presignMediaSchema = z.object({
  filename: z.string().trim().min(1, 'Filename is required').max(255),
  contentType: z.enum(ACCEPTED_MEDIA_TYPES, 'That file type is not accepted'),
})

/**
 * Recorded only after the browser's PUT succeeded. `key` is the one the presign
 * handed out — the service confirms the object is actually there before writing
 * a row, so a failed upload cannot leave a broken <img> in the gallery.
 */
export const createMediaSchema = z.object({
  key: z.string().trim().min(1).max(512),
  altText: z.string().trim().max(300).nullish().transform((value) => value || null),
})

export const updateMediaSchema = z
  .object({
    altText: z.string().trim().max(300).nullish().transform((value) => value || null),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export const mediaParamSchema = z.object({
  id: z.uuid('Not a valid id'),
  mediaId: z.uuid('Not a valid id'),
})

// ─── variants ────────────────────────────────────────────────────────────────

export const variantParamSchema = z.object({
  id: z.uuid('Not a valid id'),
  variantId: z.uuid('Not a valid id'),
})

export const createVariantSchema = z.object({
  // Optional: derived from the product and its option values when omitted,
  // which is what the grid's "auto-generate SKUs" leans on.
  sku: skuSchema.optional(),
  barcode: barcodeSchema,
  price: moneySchema,
  compareAtPrice: optionalMoneySchema,
  mediaId: z.uuid('Not a valid id').nullish(),
  status: entityStatusSchema.default('ACTIVE'),
  /** One value per option the product uses, in any order. */
  optionValueIds: z.array(z.uuid('Not a valid id')).max(3).default([]),
  /** Opening stock. Writes an ADJUSTMENT ledger row like any other stock move. */
  quantity: quantitySchema.optional(),
  lowStockThreshold: quantitySchema.optional(),
})

export const updateVariantSchema = z
  .object({
    sku: skuSchema.optional(),
    barcode: barcodeSchema,
    price: moneySchema.optional(),
    compareAtPrice: optionalMoneySchema,
    mediaId: z.uuid('Not a valid id').nullish(),
    status: entityStatusSchema.optional(),
    // No `quantity`. Stock is editable when a variant is created and moves only
    // through inventory adjust or restock afterwards, so that every change
    // carries a reason and an author. See modules/inventory.
    lowStockThreshold: quantitySchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

/**
 * The spreadsheet save: one request for every edited row. Anything absent on a
 * row is left alone, so tabbing through the price column does not blank the
 * SKUs beside it.
 */
export const bulkVariantSchema = z.object({
  variants: z
    .array(
      z.object({
        id: z.uuid('Not a valid id'),
        sku: skuSchema.optional(),
        barcode: barcodeSchema,
        price: moneySchema.optional(),
        compareAtPrice: optionalMoneySchema,
        mediaId: z.uuid('Not a valid id').nullish(),
        status: entityStatusSchema.optional(),
        lowStockThreshold: quantitySchema.optional(),
      }),
    )
    .min(1, 'Nothing to save')
    .max(500),
})

/**
 * Generate is additive and explicit: nothing is derivable from the category, so
 * the caller names every option and every value it wants combined.
 *
 * `dryRun` is not an optimisation. Generating 40 rows and finding out
 * afterwards that six were removed is how a morning's pricing work disappears,
 * so the UI always asks first and commits second.
 */
export const generateVariantsSchema = z.object({
  dryRun: z.boolean().default(false),
  options: z
    .array(
      z.object({
        variantOptionId: z.uuid('Not a valid id'),
        valueIds: z.array(z.uuid('Not a valid id')).min(1, 'Pick at least one value'),
      }),
    )
    .min(1, 'Pick at least one option')
    .max(3, 'Three options is the most a variant grid stays usable at'),
  defaults: z.object({
    price: moneySchema,
    compareAtPrice: optionalMoneySchema,
    quantity: quantitySchema.default(0),
    /**
     * Tokens: `{brand}`, `{title}`, and one per option slug — `{color}`,
     * `{size}`. Unknown tokens are dropped rather than left in the SKU.
     */
    skuPattern: z.string().trim().max(120).nullish().transform((value) => value || null),
  }),
  /**
   * Whether combinations outside the selection are deleted. Off by default:
   * unticking a value should not silently destroy the variant that held the
   * stock. The dry run reports what would go, and the operator opts in.
   */
  removeUnselected: z.boolean().default(false),
})

export type ProductListQuery = z.infer<typeof productListQuerySchema>
export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type ProductAttributeInput = z.infer<typeof productAttributeInputSchema>
export type DuplicateProductInput = z.infer<typeof duplicateProductSchema>
export type BulkProductInput = z.infer<typeof bulkProductSchema>
export type PresignMediaInput = z.infer<typeof presignMediaSchema>
export type CreateMediaInput = z.infer<typeof createMediaSchema>
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>
export type MediaParam = z.infer<typeof mediaParamSchema>
export type VariantParam = z.infer<typeof variantParamSchema>
export type CreateVariantInput = z.infer<typeof createVariantSchema>
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>
export type BulkVariantInput = z.infer<typeof bulkVariantSchema>
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>
