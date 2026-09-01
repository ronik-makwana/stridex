import { z } from 'zod'
import { shopPaginationSchema } from './common.schema.js'

export const REVIEW_BODY_MAX = 1000

export const reviewRatingSchema = z
  .number()
  .int('Pick a whole number of stars')
  .min(1, 'Pick at least one star')
  .max(5, 'Five stars is the most there is')

export const reviewBodySchema = z
  .string()
  .trim()
  .min(1, 'Write a few words about the product')
  .max(REVIEW_BODY_MAX, `Use at most ${REVIEW_BODY_MAX} characters`)

export const createReviewSchema = z.object({
  rating: reviewRatingSchema,
  body: reviewBodySchema,
})

/** Both fields optional, but sending neither is a no-op the client should not make. */
export const updateReviewSchema = z
  .object({
    rating: reviewRatingSchema.optional(),
    body: reviewBodySchema.optional(),
  })
  .refine((values) => values.rating !== undefined || values.body !== undefined, {
    message: 'Change the rating or the review before saving',
  })

/**
 * `sort` is an allow-list. Anything else is a 400 — a mistyped sort that
 * quietly falls back to newest is a bug found in production.
 */
export const reviewListQuerySchema = shopPaginationSchema.extend({
  sort: z.enum(['newest', 'oldest', 'highest', 'lowest']).default('newest'),
})

export type CreateReviewInput = z.infer<typeof createReviewSchema>
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>
