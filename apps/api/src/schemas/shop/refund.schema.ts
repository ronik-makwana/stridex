import { z } from 'zod'

/**
 * What a customer sends when they want their money back.
 *
 * The reason is an enum rather than free text because it is read in aggregate:
 * DAMAGED trending on one SKU is a supplier problem and WRONG_SIZE trending is
 * a size-guide problem, and a textarea answers neither. The comment is where
 * the words go, and it is required for OTHER — a reason of "other" with nothing
 * beside it is a row nobody can act on.
 */
export const refundReasonSchema = z.enum(
  [
    'CHANGED_MIND',
    'WRONG_SIZE',
    'DAMAGED',
    'NOT_AS_DESCRIBED',
    'WRONG_ITEM',
    'LATE_DELIVERY',
    'OTHER',
  ],
  'Choose a reason',
)

const commentSchema = z
  .string()
  .trim()
  .max(500, 'Use at most 500 characters')
  .nullish()
  .transform((value) => value || null)

const withReasonDetail = <T extends z.ZodType<{ reason: string; comment: string | null }>>(schema: T) =>
  schema.refine((input) => input.reason !== 'OTHER' || Boolean(input.comment), {
    message: 'Tell us what happened',
    path: ['comment'],
  })

export const cancelOrderSchema = withReasonDetail(
  z.object({
    reason: refundReasonSchema,
    comment: commentSchema,
  }),
)

/**
 * Which lines are coming back, and how many of each.
 *
 * Quantities rather than whole lines: two of the same shoe on one line is one
 * row, and sending one of them back is the ordinary case. The server prices
 * this from the order's own snapshot columns — the client never sends an
 * amount, because an amount a client can name is an amount it can change (§21).
 */
export const returnItemSchema = z.object({
  orderItemId: z.uuid('Not a valid id'),
  quantity: z.coerce.number().int().min(1, 'Choose at least one').max(1000),
})

export const createReturnSchema = withReasonDetail(
  z.object({
    items: z
      .array(returnItemSchema)
      .min(1, 'Choose what you are sending back')
      .max(100)
      // One row per line. Two rows naming the same line is a client bug that
      // would otherwise be priced twice.
      .refine(
        (items) => new Set(items.map((item) => item.orderItemId)).size === items.length,
        'That item is listed twice',
      ),
    reason: refundReasonSchema,
    comment: commentSchema,
  }),
)

export const requestIdParamSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(32)
    .regex(/^ORD-\d+$/, 'Not an order number'),
  requestId: z.uuid('Not a valid id'),
})

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>
export type CreateReturnInput = z.infer<typeof createReturnSchema>
export type RequestIdParam = z.infer<typeof requestIdParamSchema>
