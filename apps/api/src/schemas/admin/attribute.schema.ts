import { z } from 'zod'
import {
  booleanQuerySchema,
  paginationSchema,
  searchSchema,
  slugSchema,
  sortSchema,
} from './common.schema.js'

export const attributeTypeSchema = z.enum([
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
])

/** Only these two hold a value list; the rest store their value on the product. */
export const LIST_TYPES = ['SELECT', 'MULTI_SELECT'] as const

export type AttributeType = z.infer<typeof attributeTypeSchema>

export const isListType = (type: AttributeType): boolean =>
  (LIST_TYPES as readonly string[]).includes(type)

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Use at most 120 characters')

/**
 * The suffix shown after a NUMBER value — 'g', 'mm', 'cm'. Empty means none, so
 * a cleared input reads as "remove the unit" rather than failing validation.
 */
const unitSchema = z
  .string()
  .trim()
  .max(16, 'Use at most 16 characters')
  .nullish()
  .transform((value) => value || null)

const valueSchema = z
  .string()
  .trim()
  .min(1, 'Value is required')
  .max(120, 'Use at most 120 characters')

export const attributeListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  type: attributeTypeSchema.optional(),
  isFilterable: booleanQuerySchema,
  /**
   * Nests each attribute's values in the list response. The product editor
   * needs every SELECT's options to render its controls, and one request that
   * carries them beats one detail call per attribute on the form.
   */
  withValues: booleanQuerySchema,
  sort: sortSchema(['name', 'type', 'position', 'created_at', 'updated_at'], 'name:asc'),
})

export const createAttributeSchema = z.object({
  name: nameSchema,
  // Optional: the service derives it from the name when the form leaves it
  // untouched, which is the common path.
  slug: slugSchema.optional(),
  type: attributeTypeSchema,
  unit: unitSchema,
  isFilterable: z.boolean().default(false),
  isSuggested: z.boolean().default(false),
})

/**
 * PATCH semantics: absent means "leave it", `null` on a nullable field means
 * "clear it". `type` is accepted but the service refuses it once values exist —
 * changing SELECT to NUMBER would orphan every value row and every product
 * pointing at one.
 */
export const updateAttributeSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    type: attributeTypeSchema.optional(),
    unit: unitSchema,
    isFilterable: z.boolean().optional(),
    isSuggested: z.boolean().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export const createAttributeValueSchema = z.object({
  value: valueSchema,
  slug: slugSchema.optional(),
})

export const updateAttributeValueSchema = z
  .object({
    value: valueSchema.optional(),
    slug: slugSchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export type AttributeListQuery = z.infer<typeof attributeListQuerySchema>
export type CreateAttributeInput = z.infer<typeof createAttributeSchema>
export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>
export type CreateAttributeValueInput = z.infer<typeof createAttributeValueSchema>
export type UpdateAttributeValueInput = z.infer<typeof updateAttributeValueSchema>
