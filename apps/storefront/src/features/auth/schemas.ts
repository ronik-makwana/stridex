import { z } from 'zod'

/**
 * Client-side mirrors of `apps/api/src/schemas/shop/auth.schema.ts`. They exist
 * to catch a typo before a round trip, not to decide anything — the server
 * revalidates every one of these, and where the two disagree the server wins.
 * Keep the messages friendlier here; the API's are the fallback.
 */

export const loginSchema = z.object({
  email: z.email('Enter a valid email address').trim(),
  // Not the registration policy: an account made under older rules must still
  // be able to sign in.
  password: z.string().min(1, 'Enter your password'),
})

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.email('Enter a valid email address').trim(),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
    .optional()
    .or(z.literal('')),
})

export const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email address').trim(),
})

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  // Confirmation is a client-side courtesy only. The API takes one password and
  // has no opinion about a second field that never leaves the browser.
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>
