import { z } from 'zod'

/**
 * Mirrors `apps/api/src/schemas/admin/category.schema.ts`. The client copy
 * exists to catch mistakes before a round trip, not to be the authority — the
 * server validates again regardless.
 *
 * `level` and `position` are absent on purpose: both are derived server side,
 * from the parent and from a drag respectively.
 */
export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Use at most 120 characters'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .max(120, 'Use at most 120 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens'),
  description: z
    .string()
    .trim()
    .max(2000, 'Use at most 2000 characters')
    // '' from a cleared textarea means "no description", not a failure.
    .transform((value) => value || null),
  // The select carries '' for the top level, since a Radix item cannot hold null.
  parentId: z
    .union([z.literal(''), z.uuid('Pick a category from the list')])
    .transform((value) => value || null),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
})

export type CategoryFormValues = z.input<typeof categorySchema>
export type CategoryValues = z.output<typeof categorySchema>
