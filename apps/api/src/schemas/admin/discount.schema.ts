import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

/**
 * A discount, as the admin form fills it in.
 *
 * Every discount here is a **code** the customer types. Automatic discounts are
 * a different feature with different rules, and giving one a unique code just
 * to satisfy the column would be inventing data to fit a table.
 *
 * The shape is deliberately wider than one kind: `kind` picks between product,
 * order and shipping discounts, and the refinements below only demand what that
 * kind actually needs. Today only PRODUCT has a screen.
 */

const codeSchema = z
  .string()
  .trim()
  .min(3, 'A code needs at least 3 characters')
  .max(40, 'Keep the code under 40 characters')
  .regex(/^[a-z0-9_-]+$/i, 'Letters, numbers, hyphens and underscores only')
  // Stored upper-case so 'save20' and 'SAVE20' cannot both exist. The unique
  // index is what enforces it; this is what makes the index reachable.
  .transform((value) => value.toUpperCase())

const idListSchema = z.array(z.uuid()).max(200, 'That is more than one discount should carry')

const optionalPositiveInt = z.coerce
  .number()
  .int()
  .positive('Must be at least 1')
  .nullish()
  .transform((value) => value ?? null)

const optionalMoney = z.coerce
  .number()
  .positive('Must be more than zero')
  .nullish()
  .transform((value) => value ?? null)

export const discountKindSchema = z.enum(['PRODUCT', 'ORDER', 'SHIPPING'])

const bodySchema = z.object({
  code: codeSchema,
  description: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((value) => value || null),
  kind: discountKindSchema.default('PRODUCT'),

  // ── the value ──────────────────────────────────────────────────────────────
  type: z.enum(['PERCENT', 'FIXED'], { message: 'Choose a percentage or an amount' }),
  value: z.coerce.number().positive('Enter a discount value'),
  /** Caps a percentage: '20% off, up to ₹500'. Meaningless on a fixed amount. */
  maxDiscountAmount: optionalMoney,

  // ── what it applies to (product discounts) ────────────────────────────────
  appliesTo: z.enum(['PRODUCTS', 'CATEGORIES', 'COLLECTIONS']).nullish(),
  productIds: idListSchema.default([]),
  categoryIds: idListSchema.default([]),
  collectionIds: idListSchema.default([]),

  // ── who may use it ────────────────────────────────────────────────────────
  eligibility: z.enum(['ALL_CUSTOMERS', 'SPECIFIC_CUSTOMERS']).default('ALL_CUSTOMERS'),
  customerIds: idListSchema.default([]),

  // ── the gate before it applies ────────────────────────────────────────────
  minRequirement: z.enum(['NONE', 'PURCHASE_AMOUNT', 'ITEM_QUANTITY']).default('NONE'),
  minCartValue: optionalMoney,
  minQuantity: optionalPositiveInt,

  /** SHIPPING only: the rate above which the discount does not apply. */
  maxShippingAmount: optionalMoney,

  // ── how often ─────────────────────────────────────────────────────────────
  usageLimit: optionalPositiveInt,
  perUserLimit: optionalPositiveInt,

  // ── what it may sit alongside ─────────────────────────────────────────────
  combinesWithProduct: z.boolean().default(false),
  combinesWithOrder: z.boolean().default(false),
  combinesWithShipping: z.boolean().default(false),

  // ── when ──────────────────────────────────────────────────────────────────
  startsAt: z.coerce.date({ message: 'Choose a start date' }),
  /**
   * The end date is the off switch. Null means it runs until somebody stops it;
   * a moment in the past means it is over.
   */
  endsAt: z.coerce.date().nullish(),
})

/**
 * The rules that need more than one field to check.
 *
 * Each error is attached to the field the operator has to go and fix — a form
 * that says "invalid" at the top and leaves them hunting is a form that gets
 * abandoned (§16).
 */
function refine(values: z.infer<typeof bodySchema>, ctx: z.RefinementCtx) {
  if (values.type === 'PERCENT' && values.value > 100) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot exceed 100' })
  }

  if (values.kind === 'PRODUCT') {
    if (!values.appliesTo) {
      ctx.addIssue({ code: 'custom', path: ['appliesTo'], message: 'Choose what this applies to' })
    }
    const targets = {
      PRODUCTS: ['productIds', values.productIds, 'product'],
      CATEGORIES: ['categoryIds', values.categoryIds, 'category'],
      COLLECTIONS: ['collectionIds', values.collectionIds, 'collection'],
    } as const
    const chosen = values.appliesTo ? targets[values.appliesTo] : null
    if (chosen && chosen[1].length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: [chosen[0]],
        message: `Choose at least one ${chosen[2]}`,
      })
    }
  }

  if (values.eligibility === 'SPECIFIC_CUSTOMERS' && values.customerIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['customerIds'], message: 'Choose at least one customer' })
  }

  if (values.minRequirement === 'PURCHASE_AMOUNT' && !values.minCartValue) {
    ctx.addIssue({ code: 'custom', path: ['minCartValue'], message: 'Enter a minimum amount' })
  }
  if (values.minRequirement === 'ITEM_QUANTITY' && !values.minQuantity) {
    ctx.addIssue({ code: 'custom', path: ['minQuantity'], message: 'Enter a minimum quantity' })
  }

  if (values.kind !== 'SHIPPING' && values.maxShippingAmount) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxShippingAmount'],
      message: 'Only a shipping discount can exclude rates',
    })
  }

  if (values.endsAt && values.endsAt <= values.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end must come after the start' })
  }
}

export const createDiscountSchema = bodySchema.superRefine(refine)

/**
 * A full replace rather than a patch. The relations make a partial update
 * ambiguous — an absent `productIds` could mean "leave them" or "clear them" —
 * and a discount is small enough that the form always has all of it.
 */
export const updateDiscountSchema = bodySchema.superRefine(refine)

export const discountListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  kind: discountKindSchema.optional(),
  /** Derived from the dates, not stored — see the serializer. */
  state: z.enum(['ACTIVE', 'SCHEDULED', 'EXPIRED']).optional(),
  sort: sortSchema(['code', 'created_at', 'used_count'], 'created_at:desc'),
})

/**
 * Activate clears the end date; deactivate sets it to now. Both are expressed
 * as an intent rather than as a date the client picked, so the server is the
 * one holding the clock (§21).
 */
export const discountStateSchema = z.object({
  action: z.enum(['ACTIVATE', 'DEACTIVATE'], { message: 'Unknown action' }),
})

export type DiscountListQuery = z.infer<typeof discountListQuerySchema>
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>
export type DiscountStateInput = z.infer<typeof discountStateSchema>
