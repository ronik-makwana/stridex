import { z } from 'zod'

const slugField = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(120, 'Use at most 120 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

/**
 * Mirrors `apps/api/src/schemas/admin/variant-option.schema.ts`. The client copy
 * exists to catch mistakes before a round trip, not to be the authority — the
 * server validates again regardless.
 */
export const variantOptionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Use at most 120 characters'),
  slug: slugField,
})

export const optionValueSchema = z.object({
  value: z.string().trim().min(1, 'Value is required').max(120, 'Use at most 120 characters'),
  slug: slugField,
  // '' from a cleared picker means "no swatch". The server normalises case too,
  // but doing it here keeps what was typed and what is stored identical.
  swatchHex: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^#[0-9A-F]{6}$/, 'Use a six-digit hex colour, e.g. #1A2B3C'),
    ])
    .nullable()
    .transform((value) => value || null),
})

export type VariantOptionFormValues = z.input<typeof variantOptionSchema>
export type VariantOptionValues = z.output<typeof variantOptionSchema>
export type OptionValueValues = z.output<typeof optionValueSchema>
