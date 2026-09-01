import { z } from 'zod'
import { entityStatusSchema, paginationSchema, searchSchema, sortSchema } from './common.schema.js'

/**
 * A testimonial is merchandising copy with a name on it, so the fields are the
 * ones a merchandiser has to hand: the words, who said them, and enough context
 * for the name to mean something.
 */
const quoteSchema = z
  .string()
  .trim()
  .min(10, 'A testimonial needs more than a few words')
  .max(600, 'Keep it under 600 characters — the front page has room for a paragraph, not a page')

const authorSchema = z.string().trim().min(1, 'Who said it?').max(120)

const roleSchema = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((value) => value || null)

/** Optional on purpose: an invented number of stars is worse than none. */
const ratingSchema = z.coerce.number().int().min(1).max(5).nullish()

const imageUrlSchema = z
  .url('Enter a valid URL')
  .max(2048)
  .nullish()
  .or(z.literal('').transform(() => null))

export const testimonialListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  status: entityStatusSchema.optional(),
  sort: sortSchema(['position', 'created_at'], 'position:asc'),
})

export const createTestimonialSchema = z.object({
  quote: quoteSchema,
  authorName: authorSchema,
  authorRole: roleSchema,
  rating: ratingSchema,
  imageUrl: imageUrlSchema,
  status: entityStatusSchema.default('DRAFT'),
})

export const updateTestimonialSchema = z
  .object({
    quote: quoteSchema.optional(),
    authorName: authorSchema.optional(),
    authorRole: roleSchema,
    rating: ratingSchema,
    imageUrl: imageUrlSchema,
    status: entityStatusSchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export type TestimonialListQuery = z.infer<typeof testimonialListQuerySchema>
export type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>
export type UpdateTestimonialInput = z.infer<typeof updateTestimonialSchema>
