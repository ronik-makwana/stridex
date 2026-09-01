import { z } from 'zod'
import { shopPasswordSchema } from './auth.schema.js'
import { shopPhoneSchema } from './common.schema.js'

/**
 * The profile a customer can edit about themselves. Not `role`, not `status`,
 * not `emailVerifiedAt` — an optional-and-ignored field is one careless spread
 * away from being honoured.
 */
export const updateAccountSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter your first name').max(80).optional(),
    lastName: z.string().trim().max(80).nullish().transform((value) => value || null),
    phone: shopPhoneSchema.nullish().or(z.literal('').transform(() => null)),
    /**
     * Changing it un-verifies the account and sends a fresh link: an address
     * nobody has proved they can read is not an address to send order updates
     * to.
     */
    email: z.email('Enter a valid email address').trim().toLowerCase().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

/**
 * The current password is required and is not a formality: it is what stops a
 * borrowed, unlocked laptop from becoming a permanent account takeover.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: shopPasswordSchema,
})

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
