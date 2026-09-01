// Hand-written storefront request/response types. Deliberately not shared with
// apps/admin and deliberately not imported from the API — see
// repo-structure.md. Once the API exposes an OpenAPI document, `npm run
// gen:api` regenerates this file in place.
//
// These mirror `apps/api/src/serializers/shop/`, never `serializers/admin/`.
// If a field here has no counterpart there, one of the two is wrong.

export type UserRole = 'ADMIN' | 'STAFF' | 'CUSTOMER'

/**
 * A customer's view of their own account. Narrower than the admin's `AdminUser`
 * on purpose: no `status`, no `updatedAt`, and verification arrives as a
 * boolean rather than a timestamp.
 */
export type ShopUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  phone: string | null
  role: UserRole
  emailVerified: boolean
  createdAt: string
}

export type AuthSession = {
  user: ShopUser
  accessToken: string
}

export type RegisterResponse = AuthSession & {
  verificationEmailSent: boolean
}

// ─── conventions every list and error inherits ───────────────────────────────

/** The `meta` block on every storefront list response. */
export type ListMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type Paginated<T> = {
  data: T[]
  meta: ListMeta
}

/**
 * The error codes the UI is allowed to branch on. Anything outside this union
 * renders as a generic message — a `switch` that grows a case for an
 * undocumented code is how the storefront ends up coupled to an API internal.
 *
 * Only OUT_OF_STOCK and PRODUCT_UNAVAILABLE can fire before Phase 15; the rest
 * are declared now so checkout adds no new shape to this file.
 */
export type ShopErrorCode =
  | 'OUT_OF_STOCK'
  | 'PRICE_CHANGED'
  | 'PRODUCT_UNAVAILABLE'
  | 'CHECKOUT_EXPIRED'
  | 'CHECKOUT_ALREADY_COMPLETED'
  | 'QUANTITY_EXCEEDED'
  | 'COUPON_INVALID'

export type ApiErrorBody = {
  error: {
    code: ShopErrorCode | string
    message: string
    /** Field-level messages, keyed by form field name. */
    fields?: Record<string, string>
    /** Why a coupon or a status transition was refused. Printed verbatim (§20). */
    reason?: string
  }
}

/**
 * Stock as the customer is allowed to see it. The API never sends a count, so
 * there is no number here to accidentally render (§18).
 */
export type StockBucket = 'IN_STOCK' | 'LOW_STOCK' | 'SOLD_OUT'

export type MessageResponse = { message: string }
