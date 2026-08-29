import { z } from 'zod'

/**
 * Mirrors `apps/api/src/schemas/admin/brand.schema.ts`. The client copy exists
 * to catch mistakes before a round trip, not to be the authority — the server
 * validates again regardless.
 */
export const brandSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Use at most 120 characters'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .max(120, 'Use at most 120 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens'),
  logoUrl: z
    .union([z.literal(''), z.url('Enter a valid URL').max(2048)])
    .transform((value) => value || null),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
})

export type BrandFormValues = z.input<typeof brandSchema>
export type BrandValues = z.output<typeof brandSchema>
