import { z } from 'zod'

const slugField = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(120, 'Use at most 120 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

const entityStatus = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])

/**
 * Money stays a string the whole way: what was typed, what is validated and
 * what is posted are the same characters. Turning '8999.95' into a float on the
 * way through is how a price picks up a stray paisa nobody can reproduce.
 */
export const moneyField = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount with at most two decimal places')

/** '' from a cleared compare-at input means "no compare price". */
export const optionalMoneyField = z
  .union([z.literal(''), moneyField])
  .nullable()
  .transform((value) => value || null)

/**
 * Mirrors `apps/api/src/schemas/admin/product.schema.ts`. The client copy exists
 * to catch mistakes before a round trip, not to be the authority — the server
 * validates again regardless.
 */
export const productSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Use at most 200 characters'),
  slug: slugField,
  description: z
    .string()
    .trim()
    .max(20_000, 'That description is too long')
    .nullable()
    .transform((value) => value || null),
  // '' is what an unset Select posts. It means "no brand", not a bad id.
  brandId: z
    .union([z.literal(''), z.uuid()])
    .nullable()
    .transform((value) => value || null),
  categoryId: z
    .union([z.literal(''), z.uuid()])
    .nullable()
    .transform((value) => value || null),
  status: entityStatus,
})

/** One attribute row, as the editor holds it before the server types it. */
export type AttributeDraft = {
  attributeId: string
  attributeValueId?: string | null
  valueText?: string | null
  valueNumber?: string | null
  valueBoolean?: boolean | null
}

/** What the resolver hands `onSubmit` — the parsed, coerced shape. */
export type ProductOutput = z.output<typeof productSchema>

/** What actually goes to the API: the form plus the two lists the panels own. */
export type ProductValues = ProductOutput & {
  attributes?: AttributeDraft[]
  variantOptions?: { variantOptionId: string }[]
}

export type ProductFormValues = z.input<typeof productSchema>

// ─── variants ────────────────────────────────────────────────────────────────

export const skuField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'SKU is required')
  .max(64, 'Use at most 64 characters')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, numbers, dots, dashes and underscores')

export const variantSchema = z.object({
  sku: skuField.optional(),
  barcode: z
    .string()
    .trim()
    .max(64)
    .nullable()
    .transform((value) => value || null)
    .optional(),
  price: moneyField,
  compareAtPrice: optionalMoneyField.optional(),
  mediaId: z.uuid().nullable().optional(),
  status: entityStatus.optional(),
  optionValueIds: z.array(z.uuid()).default([]),
  quantity: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
})

export type VariantValues = z.output<typeof variantSchema>

export type BulkVariantValues = {
  variants: {
    id: string
    sku?: string
    barcode?: string | null
    price?: string
    compareAtPrice?: string | null
    mediaId?: string | null
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
    lowStockThreshold?: number
  }[]
}

export type GenerateValues = {
  dryRun: boolean
  options: { variantOptionId: string; valueIds: string[] }[]
  defaults: {
    price: string
    compareAtPrice?: string | null
    quantity?: number
    skuPattern?: string | null
  }
  removeUnselected: boolean
}
