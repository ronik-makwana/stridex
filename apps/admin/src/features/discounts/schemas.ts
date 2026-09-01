import { z } from 'zod'

/**
 * The form's own rules, mirroring the server's.
 *
 * Both exist on purpose. This one turns a mistake into a message beside the
 * field as it is typed; the server's is the one that decides, because a form
 * is a convenience and an API is a contract (§17).
 *
 * Everything numeric is a **string** here: an `<input type="number">` is empty,
 * mid-typed or '-' long before it is a number, and coercing on every keystroke
 * turns a cleared field into a 0 the operator never entered.
 */

const positive = (value: string) => value.trim() !== '' && Number(value) > 0

export const discountFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'A code needs at least 3 characters')
      .max(40, 'Keep the code under 40 characters')
      .regex(/^[a-z0-9_-]+$/i, 'Letters, numbers, hyphens and underscores only'),

    type: z.enum(['PERCENT', 'FIXED']),
    value: z.string(),
    capEnabled: z.boolean(),
    maxDiscountAmount: z.string(),

    appliesTo: z.enum(['PRODUCTS', 'CATEGORIES', 'COLLECTIONS']),

    eligibility: z.enum(['ALL_CUSTOMERS', 'SPECIFIC_CUSTOMERS']),

    minRequirement: z.enum(['NONE', 'PURCHASE_AMOUNT', 'ITEM_QUANTITY']),
    minCartValue: z.string(),
    minQuantity: z.string(),

    limitTotal: z.boolean(),
    usageLimit: z.string(),
    onePerCustomer: z.boolean(),

    combinesWithProduct: z.boolean(),
    combinesWithOrder: z.boolean(),
    combinesWithShipping: z.boolean(),

    startsAtDate: z.string().min(1, 'Choose a start date'),
    startsAtTime: z.string().min(1, 'Choose a start time'),
    hasEndDate: z.boolean(),
    endsAtDate: z.string(),
    endsAtTime: z.string(),
  })
  .superRefine((values, ctx) => {
    if (!positive(values.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a discount value' })
    } else if (values.type === 'PERCENT' && Number(values.value) > 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot exceed 100' })
    }

    if (values.type === 'PERCENT' && values.capEnabled && !positive(values.maxDiscountAmount)) {
      ctx.addIssue({ code: 'custom', path: ['maxDiscountAmount'], message: 'Enter a maximum' })
    }

    if (values.minRequirement === 'PURCHASE_AMOUNT' && !positive(values.minCartValue)) {
      ctx.addIssue({ code: 'custom', path: ['minCartValue'], message: 'Enter a minimum amount' })
    }
    if (values.minRequirement === 'ITEM_QUANTITY' && !positive(values.minQuantity)) {
      ctx.addIssue({ code: 'custom', path: ['minQuantity'], message: 'Enter a minimum quantity' })
    }

    if (values.limitTotal && !positive(values.usageLimit)) {
      ctx.addIssue({ code: 'custom', path: ['usageLimit'], message: 'Enter how many times' })
    }

    if (values.hasEndDate) {
      if (!values.endsAtDate) {
        ctx.addIssue({ code: 'custom', path: ['endsAtDate'], message: 'Choose an end date' })
      } else {
        const starts = new Date(`${values.startsAtDate}T${values.startsAtTime || '00:00'}`)
        const ends = new Date(`${values.endsAtDate}T${values.endsAtTime || '23:59'}`)
        if (ends <= starts) {
          ctx.addIssue({
            code: 'custom',
            path: ['endsAtDate'],
            message: 'The end must come after the start',
          })
        }
      }
    }
  })

export type DiscountFormValues = z.input<typeof discountFormSchema>
