import { z } from 'zod'
import { paginationSchema, searchSchema, slugSchema, sortSchema } from './common.schema.js'

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Use at most 120 characters')

const valueSchema = z
  .string()
  .trim()
  .min(1, 'Value is required')
  .max(120, 'Use at most 120 characters')

/**
 * The swatch the storefront paints for a colour value. Six-digit hex only —
 * three-digit shorthand and named colours both render, but a stored mix of
 * formats makes every consumer normalise, so it is normalised here instead.
 * '' from a cleared picker means "no swatch", not a validation failure.
 */
const swatchHexSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^#[0-9A-F]{6}$/, 'Use a six-digit hex colour, e.g. #1A2B3C')
  .nullish()
  .or(z.literal('').transform(() => null))

export const variantOptionListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  sort: sortSchema(['name', 'position', 'created_at', 'updated_at'], 'position:asc'),
})

export const createVariantOptionSchema = z.object({
  name: nameSchema,
  slug: slugSchema.optional(),
})

export const updateVariantOptionSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export const createVariantOptionValueSchema = z.object({
  value: valueSchema,
  slug: slugSchema.optional(),
  swatchHex: swatchHexSchema,
})

export const updateVariantOptionValueSchema = z
  .object({
    value: valueSchema.optional(),
    slug: slugSchema.optional(),
    swatchHex: swatchHexSchema,
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export type VariantOptionListQuery = z.infer<typeof variantOptionListQuerySchema>
export type CreateVariantOptionInput = z.infer<typeof createVariantOptionSchema>
export type UpdateVariantOptionInput = z.infer<typeof updateVariantOptionSchema>
export type CreateVariantOptionValueInput = z.infer<typeof createVariantOptionValueSchema>
export type UpdateVariantOptionValueInput = z.infer<typeof updateVariantOptionValueSchema>
