import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

export const reviewStatusSchema = z.enum(['PUBLISHED', 'HIDDEN'])

/**
 * Moderation's queue. `status=HIDDEN` is what somebody opens after hiding a
 * batch to check they were right; the default is everything, because the
 * common task is reading what has come in.
 */
export const reviewListQuerySchema = paginationSchema.extend({
  /** Body text, product title, or the author's email. */
  q: searchSchema,
  status: reviewStatusSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  productId: z.uuid('Not a valid id').optional(),
  sort: sortSchema(['created_at', 'rating'], 'created_at:desc'),
})

export const reviewStatusInputSchema = z.object({
  status: reviewStatusSchema,
})

export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>
export type ReviewStatusInput = z.infer<typeof reviewStatusInputSchema>
