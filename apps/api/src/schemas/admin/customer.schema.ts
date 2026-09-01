import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

export const customerStatusSchema = z.enum(['ACTIVE', 'SUSPENDED'])

export const customerListQuerySchema = paginationSchema.extend({
  /** Name or email — what a support call actually gives you. */
  q: searchSchema,
  status: customerStatusSchema.optional(),
  /**
   * 'unverified' is not a status column, it is `email_verified_at IS NULL`.
   * Exposed as a filter because it is the first thing anyone looks for when a
   * customer says they never got an email.
   */
  verified: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: sortSchema(['created_at', 'email'], 'created_at:desc'),
})

/**
 * Suspend or reactivate, and nothing else. There is no password field here and
 * no impersonation: either would need audit logging that does not exist, and a
 * support tool that can read a customer's session is a support tool that can
 * place orders as them.
 */
export const customerStatusInputSchema = z.object({
  status: customerStatusSchema,
})

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>
export type CustomerStatusInput = z.infer<typeof customerStatusInputSchema>
