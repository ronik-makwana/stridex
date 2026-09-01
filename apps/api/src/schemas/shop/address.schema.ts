import { z } from 'zod'
import { shopPhoneSchema } from './common.schema.js'

/**
 * A delivery address, as the customer types it. Deliberately loose about
 * everything a courier can still work with — there is no PIN-code lookup, no
 * city/state validation against a table — and strict about the two fields a
 * parcel genuinely cannot move without: a name and a reachable phone number.
 *
 * The stored address is not the one an order ships to. Placing an order copies
 * it into `order_addresses`, so editing this later never rewrites where a past
 * parcel went (§19).
 */

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the full name')
  .max(120, 'Use at most 120 characters')

const lineSchema = z
  .string()
  .trim()
  .min(1, 'Enter the address')
  .max(200, 'Use at most 200 characters')

const optionalLineSchema = z
  .string()
  .trim()
  .max(200, 'Use at most 200 characters')
  .nullish()
  .transform((value) => value || null)

const citySchema = z.string().trim().min(1, 'Enter the city').max(80)
const stateSchema = z.string().trim().min(1, 'Enter the state').max(80)

/** Six digits, never starting at zero — the whole of the Indian PIN rule. */
const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code')

/**
 * India only, and stored rather than assumed so the column means something the
 * day a second country is added. Anything else is rejected here rather than
 * quietly accepted and never shipped to.
 */
const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => value === 'IN', 'We only deliver within India')
  .default('IN')

export const createAddressSchema = z.object({
  fullName: nameSchema,
  phone: shopPhoneSchema,
  addressLine1: lineSchema,
  addressLine2: optionalLineSchema,
  city: citySchema,
  state: stateSchema,
  country: countrySchema,
  postalCode: postalCodeSchema,
  /**
   * Optional, and the service decides the rest: the first address a customer
   * saves becomes the default whatever this says, because an address book with
   * no default makes checkout ask a question nobody wants to answer twice.
   */
  isDefault: z.boolean().optional(),
})

/** PATCH semantics: absent means leave it. `isDefault: false` is not a way to un-default — promote another one instead. */
export const updateAddressSchema = z
  .object({
    fullName: nameSchema.optional(),
    phone: shopPhoneSchema.optional(),
    addressLine1: lineSchema.optional(),
    addressLine2: optionalLineSchema,
    city: citySchema.optional(),
    state: stateSchema.optional(),
    country: countrySchema.optional(),
    postalCode: postalCodeSchema.optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export type CreateAddressInput = z.infer<typeof createAddressSchema>
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>
