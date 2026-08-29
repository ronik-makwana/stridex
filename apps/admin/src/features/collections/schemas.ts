import { z } from 'zod'
import type { RuleDraft } from '@/types/api'

const slugField = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(120, 'Use at most 120 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

/**
 * Mirrors `apps/api/src/schemas/admin/collection.schema.ts`. The client copy
 * exists to catch mistakes before a round trip, not to be the authority — the
 * server validates again regardless, and the rules engine validates far more
 * than this can.
 */
export const collectionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Use at most 120 characters'),
  slug: slugField,
  description: z
    .string()
    .trim()
    .max(5000, 'That description is too long')
    .nullable()
    .transform((value) => value || null),
  imageUrl: z
    .union([z.literal(''), z.url('Enter a valid URL')])
    .nullable()
    .transform((value) => value || null),
  type: z.enum(['MANUAL', 'DYNAMIC']),
  matchType: z.enum(['ALL', 'ANY']),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
})

export type CollectionOutput = z.output<typeof collectionSchema>
export type CollectionFormValues = z.input<typeof collectionSchema>

/** What goes to the API: the form plus the rule set the builder owns. */
export type CollectionValues = CollectionOutput & { rules?: RuleDraft[] }
