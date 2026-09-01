import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

export const orderStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
])

export const orderPaymentStatusSchema = z.enum([
  'PENDING',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
])

/**
 * Two status filters, not one. Payment and fulfilment answer different
 * questions — "who has not paid" and "what needs packing" — and a single
 * combined filter cannot express either of them (§11).
 */
export const orderListQuerySchema = paginationSchema.extend({
  /** Order number, customer name or email. */
  q: searchSchema,
  status: orderStatusSchema.optional(),
  paymentStatus: orderPaymentStatusSchema.optional(),
  /** Inclusive dates on `placed_at`, falling back to `created_at`. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: sortSchema(['created_at', 'placed_at', 'total_amount', 'order_number'], 'created_at:desc'),
})

/**
 * The one mutation in the whole phase. `note` is for the history row — "customer
 * called, address wrong" is the difference between a timeline and a list of
 * timestamps.
 */
export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(500).nullish().transform((value) => value || null),
})

export type OrderListQuery = z.infer<typeof orderListQuerySchema>
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>
