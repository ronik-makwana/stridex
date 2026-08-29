import { z } from 'zod'

const slugField = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(120, 'Use at most 120 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

/**
 * Mirrors `apps/api/src/schemas/admin/attribute.schema.ts`. The client copy
 * exists to catch mistakes before a round trip, not to be the authority — the
 * server validates again regardless.
 */
export const attributeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Use at most 120 characters'),
  slug: slugField,
  type: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTI_SELECT']),
  unit: z
    .string()
    .trim()
    .max(16, 'Use at most 16 characters')
    .transform((value) => value || null),
  isFilterable: z.boolean(),
  isSuggested: z.boolean(),
})

export const attributeValueSchema = z.object({
  value: z.string().trim().min(1, 'Value is required').max(120, 'Use at most 120 characters'),
  slug: slugField,
})

export type AttributeFormValues = z.input<typeof attributeSchema>
export type AttributeValues = z.output<typeof attributeSchema>
export type AttributeValueValues = z.output<typeof attributeValueSchema>
