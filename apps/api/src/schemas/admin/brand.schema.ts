import { z } from 'zod'
import {
  entityStatusSchema,
  paginationSchema,
  searchSchema,
  slugSchema,
  sortSchema,
} from './common.schema.js'

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Use at most 120 characters')

const logoUrlSchema = z
  .url('Enter a valid URL')
  .max(2048)
  .nullish()
  // '' from a cleared input means "remove the logo", not "fail validation".
  .or(z.literal('').transform(() => null))

export const brandListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  status: entityStatusSchema.optional(),
  sort: sortSchema(['name', 'created_at', 'updated_at', 'status'], 'name:asc'),
})

export const createBrandSchema = z.object({
  name: nameSchema,
  // Optional: the service derives it from the name when the form leaves it
  // untouched, which is the common path.
  slug: slugSchema.optional(),
  logoUrl: logoUrlSchema,
  status: entityStatusSchema.default('ACTIVE'),
})

/**
 * PATCH semantics: absent means "leave it", `null` on a nullable field means
 * "clear it". `.partial()` alone cannot express that, hence the explicit shape.
 */
export const updateBrandSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    logoUrl: logoUrlSchema,
    status: entityStatusSchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export const brandStatusSchema = z.object({ status: entityStatusSchema })

export type BrandListQuery = z.infer<typeof brandListQuerySchema>
export type CreateBrandInput = z.infer<typeof createBrandSchema>
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>
export type BrandStatusInput = z.infer<typeof brandStatusSchema>
