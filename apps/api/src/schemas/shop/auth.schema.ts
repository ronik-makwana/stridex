import { z } from 'zod'

/**
 * Storefront password policy. Shorter floor than an admin console would want
 * and that is the intended trade: a customer who bounces off a 12-character
 * rule at 11pm does not come back, and the account guards a shipping address,
 * not the catalog.
 */
export const shopPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')

const emailSchema = z.email('Enter a valid email address').trim().toLowerCase()

/**
 * `role` is absent by design and is not merely ignored — the controller sets
 * CUSTOMER. An optional-and-stripped field is one refactor away from being
 * passed through.
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: shopPasswordSchema,
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().max(80).optional().or(z.literal('')),
  // Indian mobile numbers, optionally +91-prefixed. Optional at signup: asking
  // for it before there is anything to ship costs conversions, and checkout
  // collects it on the address anyway.
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
    .optional()
    .or(z.literal('')),
})

export const shopLoginSchema = z.object({
  email: emailSchema,
  // Not `shopPasswordSchema`: an account created under an older, shorter policy
  // must still be able to sign in.
  password: z.string().min(1, 'Enter your password').max(128),
})

export const shopForgotPasswordSchema = z.object({
  email: emailSchema,
})

export const shopResetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: shopPasswordSchema,
})

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
})

export const resendVerificationSchema = z.object({
  email: emailSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>
export type ShopLoginInput = z.infer<typeof shopLoginSchema>
export type ShopForgotPasswordInput = z.infer<typeof shopForgotPasswordSchema>
export type ShopResetPasswordInput = z.infer<typeof shopResetPasswordSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>
