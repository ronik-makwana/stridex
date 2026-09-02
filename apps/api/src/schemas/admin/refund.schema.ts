import { z } from 'zod'
import { paginationSchema, searchSchema, sortSchema } from './common.schema.js'

/**
 * The returns queue, and the three decisions on it.
 *
 * Approving is cheap and reversible-ish — nothing has moved. Receiving is
 * neither: it puts stock back on the shelf and sends money out, and it is the
 * only one of the three that a customer feels. So it takes the most input:
 * which units actually turned up, and which of them can be sold again.
 */

export const refundRequestStatusSchema = z.enum([
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'RECEIVED',
  'COMPLETED',
])

export const refundRequestTypeSchema = z.enum(['CANCELLATION', 'RETURN'])

export const returnListQuerySchema = paginationSchema.extend({
  /** Order number or the customer's email — what somebody has when they call. */
  q: searchSchema,
  status: refundRequestStatusSchema.optional(),
  type: refundRequestTypeSchema.optional(),
  sort: sortSchema(['created_at', 'estimated_amount'], 'created_at:desc'),
})

const noteSchema = z
  .string()
  .trim()
  .max(500, 'Use at most 500 characters')
  .nullish()
  .transform((value) => value || null)

export const approveReturnSchema = z.object({
  note: noteSchema,
})

/**
 * A rejection needs a reason, and not for the file: the customer is shown this
 * sentence. "No" with nothing after it is the message that generates the phone
 * call this queue exists to avoid.
 */
export const rejectReturnSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Tell the customer why')
    .max(500, 'Use at most 500 characters'),
})

const receivedQuantitySchema = z
  .coerce.number()
  .int('Whole units only')
  .min(0, 'Cannot be negative')
  .max(1000)

/**
 * What actually arrived, line by line.
 *
 * Two numbers rather than one, because "it came back" and "it can be sold
 * again" are different facts and the ledger has to be able to say both. A worn
 * pair is still refunded — that is what `unsellable` means — but it must not
 * become sellable stock, so it is written back in and written off in two
 * entries rather than quietly skipped (15.3).
 *
 * A line where both are zero is a line that did not turn up. It stays on the
 * request, unreceived, for the parcel that may still arrive.
 */
export const receiveReturnItemSchema = z.object({
  requestItemId: z.uuid('Not a valid id'),
  restockQuantity: receivedQuantitySchema.default(0),
  unsellableQuantity: receivedQuantitySchema.default(0),
})

export const receiveReturnSchema = z.object({
  items: z
    .array(receiveReturnItemSchema)
    .min(1, 'Say what arrived')
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.requestItemId)).size === items.length,
      'That line is listed twice',
    )
    .refine(
      (items) => items.some((item) => item.restockQuantity + item.unsellableQuantity > 0),
      'Nothing arrived — reject the return instead',
    ),
  note: noteSchema,
})

/**
 * Money as a fixed-point string, the same shape `product.schema.ts` uses and
 * for the same reason: `Decimal(12,2)` wants a string, and 89.99 turning into
 * 89.98999… between the form and the ledger is a bug nobody can reproduce.
 */
const moneySchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value.toString() : value.trim()))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), {
    message: 'Enter an amount with at most two decimal places',
  })
  .transform((value) => Number(value).toFixed(2))
  .refine((value) => Number(value) > 0, 'Enter an amount to refund')

/**
 * A refund an operator decided on: goodwill, a shipping mistake, a mark on a
 * box the customer will live with for ₹200 off.
 *
 * Money only. It moves no stock and closes no return, because it is not a
 * statement about goods — nothing came back, and the customer is keeping what
 * they have. Stock that genuinely needs adjusting is adjusted on the inventory
 * screen, where the ledger records a reason and a person (15.6).
 *
 * The amount is capped server-side against what is left on the order, which is
 * the only figure that matters and the only one the client cannot be trusted
 * to have current.
 */
export const createRefundSchema = z.object({
  amount: moneySchema,
  reason: z.enum(
    ['CHANGED_MIND', 'WRONG_SIZE', 'DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'LATE_DELIVERY', 'OTHER'],
    'Choose a reason',
  ),
  /** Internal, and required: a refund nobody explained is one nobody can audit. */
  note: z
    .string()
    .trim()
    .min(1, 'Say why this is being refunded')
    .max(500, 'Use at most 500 characters'),
})

export type CreateRefundInput = z.infer<typeof createRefundSchema>
export type ReturnListQuery = z.infer<typeof returnListQuerySchema>
export type ApproveReturnInput = z.infer<typeof approveReturnSchema>
export type RejectReturnInput = z.infer<typeof rejectReturnSchema>
export type ReceiveReturnInput = z.infer<typeof receiveReturnSchema>
