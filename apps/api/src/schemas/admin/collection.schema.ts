import { z } from 'zod'
import {
  entityStatusSchema,
  paginationSchema,
  searchSchema,
  slugSchema,
  sortSchema,
} from './common.schema.js'

export const collectionTypeSchema = z.enum(['MANUAL', 'DYNAMIC'])
export const matchTypeSchema = z.enum(['ALL', 'ANY'])

/**
 * The operators a rule can use. Which ones a given field accepts is decided by
 * the engine, not here — `price contains` is nonsense, and the message for it
 * should name the field rather than the enum.
 */
export const ruleOperatorSchema = z.enum([
  'is',
  'is_not',
  'contains',
  'greater_than',
  'less_than',
  'is_empty',
])

/**
 * Fixed fields, plus one per attribute as `attribute:<uuid>`. Attributes are
 * data, so they cannot be an enum — the shape is checked here and the id is
 * resolved against the table by the engine.
 */
export const ruleFieldSchema = z
  .string()
  .trim()
  .regex(
    /^(category|brand|price|title|sku|stock|created_at|attribute:[0-9a-fA-F-]{36})$/,
    'Not a field collections can match on',
  )

/**
 * `value` is deliberately loose. What it means depends entirely on the field —
 * a uuid for brand, a number for price, an ISO date for created_at — and the
 * engine is the only place that knows enough to check it.
 */
export const ruleInputSchema = z.object({
  field: ruleFieldSchema,
  operator: ruleOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
})

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Use at most 120 characters')

const descriptionSchema = z
  .string()
  .trim()
  .max(5000, 'That description is too long')
  .nullish()
  .transform((value) => value || null)

const imageUrlSchema = z
  .url('Enter a valid URL')
  .max(2048)
  .nullish()
  .or(z.literal('').transform(() => null))

export const collectionListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  type: collectionTypeSchema.optional(),
  status: entityStatusSchema.optional(),
  sort: sortSchema(['name', 'type', 'status', 'created_at', 'updated_at'], 'name:asc'),
})

export const createCollectionSchema = z.object({
  name: nameSchema,
  // Optional: the service derives it from the name when the form leaves it
  // untouched, which is the common path.
  slug: slugSchema.optional(),
  description: descriptionSchema,
  imageUrl: imageUrlSchema,
  type: collectionTypeSchema.default('MANUAL'),
  matchType: matchTypeSchema.default('ALL'),
  status: entityStatusSchema.default('DRAFT'),
  /** DYNAMIC only. Sent whole; the service replaces the rule set. */
  rules: z.array(ruleInputSchema).max(20).optional(),
})

/**
 * PATCH semantics: absent means "leave it", `null` on a nullable field means
 * "clear it". `rules` is a whole-list replacement — a rule builder edits the
 * set, not one row at a time, and per-rule endpoints would mean a half-applied
 * filter on the third failure.
 */
export const updateCollectionSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema,
    imageUrl: imageUrlSchema,
    type: collectionTypeSchema.optional(),
    matchType: matchTypeSchema.optional(),
    status: entityStatusSchema.optional(),
    rules: z.array(ruleInputSchema).max(20).optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

/** Unsaved by design, so the builder can call it on every edit. */
export const previewRulesSchema = z.object({
  matchType: matchTypeSchema.default('ALL'),
  rules: z.array(ruleInputSchema).max(20),
  /** How many matched products to return alongside the count. */
  limit: z.coerce.number().int().min(0).max(24).default(6),
})

export const addProductsSchema = z.object({
  productIds: z.array(z.uuid('Not a valid id')).min(1, 'Nothing to add').max(200),
})

export const collectionProductParamSchema = z.object({
  id: z.uuid('Not a valid id'),
  productId: z.uuid('Not a valid id'),
})

export const collectionProductsQuerySchema = paginationSchema

export type CollectionListQuery = z.infer<typeof collectionListQuerySchema>
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>
export type PreviewRulesInput = z.infer<typeof previewRulesSchema>
export type AddProductsInput = z.infer<typeof addProductsSchema>
export type CollectionProductParam = z.infer<typeof collectionProductParamSchema>
export type RuleInput = z.infer<typeof ruleInputSchema>
export type RuleOperator = z.infer<typeof ruleOperatorSchema>
