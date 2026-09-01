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

// ─── catalog ─────────────────────────────────────────────────────────────────

export type Ref = { id: string; name: string; slug: string }

export type ProductImage = {
  id: string
  url: string
  altText: string | null
  type: 'IMAGE' | 'VIDEO'
  sortOrder: number
}

/** One row of the spec table. The API resolves the display string. */
export type ProductAttribute = {
  id: string
  attributeId: string
  name: string
  slug: string
  value: string
}

export type OptionValue = {
  id: string
  value: string
  slug: string
  /** Present on colour axes only; drives the swatches. */
  swatchHex: string | null
  position: number
}

/** An axis of choice — Size, Colour — in this product's own order. */
export type ProductOption = {
  id: string
  name: string
  slug: string
  position: number
  values: OptionValue[]
}

export type ProductVariant = {
  id: string
  sku: string
  price: string
  compareAtPrice: string | null
  discountPercent: number | null
  /** Sorted into the product's axis order. Matching is set-based regardless. */
  optionValueIds: string[]
  stock: StockBucket
  /** Capped at 10 by the API; a display bound, never a guarantee. */
  maxQuantity: number
  /** Which image to show for this variant. Null across the catalogue today. */
  mediaId: string | null
}

export type Product = {
  id: string
  slug: string
  title: string
  description: string | null
  brand: Ref | null
  category: Ref | null
  /** Root first, this product's category last. */
  breadcrumbs: Ref[]
  media: ProductImage[]
  attributes: ProductAttribute[]
  options: ProductOption[]
  variants: ProductVariant[]
  priceRange: { min: string; max: string } | null
  stock: StockBucket
  publishedAt: string | null
}

/** The grid and "you may also like" shape. Much smaller than Product. */
export type ProductCard = {
  id: string
  slug: string
  title: string
  brand: Ref | null
  image: { url: string; altText: string | null } | null
  price: string | null
  compareAtPrice: string | null
  discountPercent: number | null
  stock: StockBucket
  /** Always present; `{ average: 0, count: 0 }` when nobody has reviewed it. */
  rating: { average: number; count: number }
}

// ─── reviews ─────────────────────────────────────────────────────────────────

export type ReviewStatus = 'PUBLISHED' | 'HIDDEN'

export type Review = {
  id: string
  rating: number
  body: string
  /** A display name — "Rhea K." Never an email; this list is public. */
  author: string
  /** Derived per request from PAID orders, never stored. */
  verifiedPurchase: boolean
  isMine: boolean
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>

export type ReviewSummary = {
  average: number
  total: number
  distribution: RatingDistribution
}

export type ReviewListResponse = {
  data: Review[]
  meta: ListMeta & {
    summary: ReviewSummary
    /** null for a guest; null for a customer who has not reviewed yet. */
    myReviewId: string | null
  }
}

// ─── browsing: categories, filters, collections ──────────────────────────────

export type CategoryNode = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  level: number
  position: number
  /** Rolled up from descendants, so a parent never reads 0. */
  productCount: number
  children?: CategoryNode[]
}

export type CategoryDetail = Omit<CategoryNode, 'children'> & {
  breadcrumbs: Ref[]
}

export type FacetValue = { id: string; label: string; count: number }

/** `id` is 'brand' or an attribute uuid — the key the query string uses. */
export type Facet = { id: string; name: string; slug: string; values: FacetValue[] }

export type FacetsResponse = {
  facets: Facet[]
  price: { min: number; max: number } | null
}

export type ProductSort = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'name_asc'

export type ProductListResponse = {
  data: ProductCard[]
  meta: ListMeta & { sort: ProductSort }
}

export type Collection = {
  id: string
  name: string
  slug: string
  description: string | null
  imageUrl: string | null
  type: 'MANUAL' | 'DYNAMIC'
  productCount: number
}

export type Suggestion = {
  products: {
    id: string
    slug: string
    title: string
    brand: string | null
    image: string | null
    price: string | null
  }[]
  categories: Ref[]
}
// ─── checkout ────────────────────────────────────────────────────────────────

export type CheckoutStatus = 'ACTIVE' | 'PAYMENT_PENDING' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED'

/**
 * A line as it was when the session opened — the snapshot payment charges and
 * the order inherits, not today's catalog. A price that moves after this is
 * quoted does not move here.
 */
export type CheckoutItem = {
  id: string
  variantId: string
  slug: string | null
  image: { url: string; altText: string | null } | null
  title: string
  sku: string
  options: { name: string; value: string }[]
  unitPrice: string
  quantity: number
  totalPrice: string
  discountAmount: string
  orderDiscountAllocated: string
}

/**
 * Every money field is a string the server computed (§21). Nothing in the
 * checkout page adds anything up — including the total it puts on the button.
 */
export type CheckoutSession = {
  id: string
  status: CheckoutStatus
  /** The deadline. The countdown drawn from it is decoration; this is the rule. */
  expiresAt: string
  items: CheckoutItem[]
  subtotal: string
  discountAmount: string
  shippingAmount: string
  totalAmount: string
  currency: string
  shippingAddress: Address | null
  billingAddress: Address | null
  /** Null until the webhook lands. Its arrival is what makes this an order. */
  order: { id: string; orderNumber: string } | null
  createdAt: string
}

export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'VOIDED'

export type Payment = {
  id: string
  orderId: string | null
  provider: string
  providerPaymentId: string
  amount: string
  currency: string
  status: PaymentStatus
  method: string | null
  createdAt: string
  /** Only on the response that created it: how to complete this attempt. */
  clientPayload?: Record<string, unknown>
}

// ─── addresses ───────────────────────────────────────────────────────────────

/**
 * A saved delivery address. Never the one an order shipped to — placing an
 * order copies it into its own table, so editing this later cannot rewrite
 * where a past parcel went.
 */
export type Address = {
  id: string
  fullName: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  country: string
  postalCode: string
  /** Exactly one per customer. The API keeps it that way, not the client. */
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

// ─── cart and wishlist ───────────────────────────────────────────────────────

/**
 * Why a line is not what the customer left it as. One per line, never a
 * page-level banner: "some items changed" makes them hunt for which (§16).
 */
export type CartLineReason = {
  code: ShopErrorCode
  message: string
  /** PRICE_CHANGED — what they last saw, struck through. */
  previousPrice?: string
  /** OUT_OF_STOCK / QUANTITY_EXCEEDED — what they asked for before the clamp. */
  requestedQuantity?: number
}

export type CartLine = {
  /** The server row's id. Null on a guest line, which has no row. */
  id: string | null
  variantId: string
  productId: string | null
  slug: string | null
  title: string | null
  brand: { id: string; name: string; slug: string } | null
  image: { url: string; altText: string | null } | null
  sku: string | null
  options: { name: string; value: string }[]
  /** Every money field is a string the server computed. The client never adds up (§21). */
  price: string | null
  compareAtPrice: string | null
  discountPercent: number | null
  quantity: number
  lineTotal: string | null
  stock: StockBucket
  maxQuantity: number
  /** False means the line cannot go to checkout, and only Remove is offered. */
  purchasable: boolean
  reason: CartLineReason | null
}

export type Cart = {
  items: CartLine[]
  /** Units, not lines — the number on the cart badge. */
  itemCount: number
  subtotal: string
  hasIssues: boolean
}

/** A saved product, plus its sizes for the inline "move to cart" picker. */
export type WishlistItem = {
  id: string
  slug: string
  title: string
  brand: { id: string; name: string; slug: string } | null
  image: { url: string; altText: string | null } | null
  price: string | null
  compareAtPrice: string | null
  discountPercent: number | null
  stock: StockBucket
  variants: { id: string; label: string; price: string; stock: StockBucket; maxQuantity: number }[]
  savedAt: string
}

