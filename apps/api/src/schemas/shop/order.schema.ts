import { z } from 'zod'
import { shopPaginationSchema } from './common.schema.js'

/**
 * Order history is a list of cards nobody sorts, so there is no `sort` here and
 * no filters — newest first is the only order that makes sense for one's own
 * orders (§3.11).
 */
export const orderListQuerySchema = shopPaginationSchema.extend({})

/**
 * Addressed by order number, not by id. `ORD-1043` is what the customer has in
 * their inbox and reads down the phone; a uuid is what they never see.
 */
export const orderNumberParamSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(32)
    .regex(/^ORD-\d+$/, 'Not an order number'),
})

export type OrderListQuery = z.infer<typeof orderListQuerySchema>
export type OrderNumberParam = z.infer<typeof orderNumberParamSchema>
