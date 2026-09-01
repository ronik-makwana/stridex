import { z } from 'zod'

/**
 * A client-side mirror of `apps/api/src/schemas/shop/address.schema.ts`. It
 * exists to catch a typo before a round trip; the server revalidates every
 * field and wins any disagreement.
 */
export const addressSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the full name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  addressLine1: z.string().trim().min(1, 'Enter the address').max(200),
  // '' from an untouched optional input means "no second line", not a failure.
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'Enter the city').max(80),
  state: z.string().trim().min(1, 'Enter the state').max(80),
  /** Six digits, never starting at zero — the whole of the Indian PIN rule. */
  postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
})

export type AddressValues = z.infer<typeof addressSchema>
