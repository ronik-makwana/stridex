import { z } from 'zod'

/**
 * Phase 11 settles the storefront's request and response dialect once, because
 * every later phase inherits it. Deliberately a separate file from
 * `schemas/admin/common.schema.ts` rather than an import: the two drift on
 * purpose — the shop caps `limit` lower, has no `status` filter to expose, and
 * must never gain an admin-only knob by sharing a base.
 */

/** Grids are 24 across four columns. 60 is the ceiling a client may ask for. */
export const shopPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
})

/**
 * The `meta` block every storefront list carries. `totalPages` is at least 1 so
 * an empty grid still renders a pager rather than "page 1 of 0".
 */
export function shopListMeta(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

/**
 * The error codes the storefront UI branches on. Everything else it renders as
 * a generic message, so this list is the contract — not a suggestion.
 *
 * Only OUT_OF_STOCK and PRODUCT_UNAVAILABLE can fire before Phase 15; the rest
 * are declared here so the client's error union is written once and the
 * checkout phases add no new shape.
 */
export const SHOP_ERROR_CODES = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  PRICE_CHANGED: 'PRICE_CHANGED',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  CHECKOUT_EXPIRED: 'CHECKOUT_EXPIRED',
  CHECKOUT_ALREADY_COMPLETED: 'CHECKOUT_ALREADY_COMPLETED',
  QUANTITY_EXCEEDED: 'QUANTITY_EXCEEDED',
  COUPON_INVALID: 'COUPON_INVALID',
  /**
   * The order has moved past the point where the customer decides. Raised when
   * a cancellation arrives after the parcel has shipped — including by a second
   * or two, which is why the check that produces it is a conditional write
   * rather than a read (15.4).
   */
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  /** Something is already open on this order. The client shows it rather than a form. */
  REFUND_ALREADY_REQUESTED: 'REFUND_ALREADY_REQUESTED',
  /**
   * Past the return window, or the order never got far enough to have one. The
   * deadline is recomputed from `delivered_at` on every read, so a client that
   * cached "returnable" an hour ago is told here rather than trusted (15.5).
   */
  RETURN_WINDOW_CLOSED: 'RETURN_WINDOW_CLOSED',
} as const

export type ShopErrorCode = (typeof SHOP_ERROR_CODES)[keyof typeof SHOP_ERROR_CODES]

/**
 * Indian mobile numbers, optionally +91-prefixed. Lives here rather than in one
 * feature's schema because two places now collect a phone number — signup and
 * a delivery address — and a courier is not interested in which form validated
 * it. One regex, one message.
 */
export const shopPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')

/** `/p/:slug`, `/c/:slug` — the storefront addresses catalog records by slug. */
export const slugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(120)
    // A slug that cannot exist is a 404 from the router, not a database round
    // trip and not a 400: a customer following a stale link gets the same page
    // whether the slug is malformed or merely gone.
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

export const shopUuidParamSchema = z.object({
  id: z.uuid('Not a valid id'),
})

export type ShopPaginationInput = z.infer<typeof shopPaginationSchema>
export type SlugParam = z.infer<typeof slugParamSchema>
export type ShopUuidParam = z.infer<typeof shopUuidParamSchema>
