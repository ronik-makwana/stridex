import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

export const paymentRecordStatusSchema = z.enum([
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'VOIDED',
])

export const paymentListQuerySchema = paginationSchema.extend({
  /** Provider payment id or order number — whichever the operator has to hand. */
  q: searchSchema,
  status: paymentRecordStatusSchema.optional(),
  provider: z.string().trim().max(40).optional(),
  sort: sortSchema(['created_at', 'amount'], 'created_at:desc'),
})

export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>
