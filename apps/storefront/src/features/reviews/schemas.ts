import { z } from 'zod'

export const REVIEW_BODY_MAX = 1000

/** Mirrors the API's schema. The server revalidates; this saves a round trip. */
export const reviewFormSchema = z.object({
  rating: z
    .number({ message: 'Pick a rating' })
    .int()
    .min(1, 'Pick at least one star')
    .max(5),
  body: z
    .string()
    .trim()
    .min(1, 'Write a few words about the product')
    .max(REVIEW_BODY_MAX, `Use at most ${REVIEW_BODY_MAX} characters`),
})

export type ReviewFormValues = z.infer<typeof reviewFormSchema>
