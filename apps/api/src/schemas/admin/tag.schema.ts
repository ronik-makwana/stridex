import { z } from 'zod'
import { searchSchema } from './common.schema.js'

/**
 * The suggestion list behind the tag input, not a management screen — so it is
 * one flat page rather than a paginated list. `limit` is what the input can
 * usefully show, and `q` is what has been typed so far.
 */
export const tagListQuerySchema = z.object({
  q: searchSchema,
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export type TagListQuery = z.infer<typeof tagListQuerySchema>
