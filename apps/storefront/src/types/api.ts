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
// ─── orders ──────────────────────────────────────────────────────────────────

export type DiscountKind = 'PRODUCT' | 'ORDER' | 'SHIPPING'

export type OrderDiscount = {
  code: string
  /** What it came off: the goods, the order total, or the delivery. */
  kind: DiscountKind
  amount: string
}

export type OrderStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'
export type OrderPaymentStatus = 'PENDING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED'

/** Why something is coming back. The wording lives in `REFUND_REASONS`. */
export type RefundReason =
  | 'CHANGED_MIND'
  | 'WRONG_SIZE'
  | 'DAMAGED'
  | 'NOT_AS_DESCRIBED'
  | 'WRONG_ITEM'
  | 'LATE_DELIVERY'
  | 'OTHER'

/** The money's own state. PENDING and PROCESSING both mean "on its way". */
export type RefundStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

export type RefundRequestType = 'CANCELLATION' | 'RETURN'
export type RefundRequestStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'RECEIVED'
  | 'COMPLETED'

/**
 * A refund on an order. Failed ones are filtered out server-side — a customer
 * being shown "failed" beside money they are still owed reads as "you are not
 * getting this", and it is staff work rather than theirs.
 */
export type OrderRefund = {
  id: string
  amount: string
  status: RefundStatus
  reason: RefundReason
  requestedAt: string
  /** Null until the provider confirms it. */
  settledAt: string | null
}

/** What is open on an order, so the page can show progress instead of a form. */
export type OrderRequestSummary = {
  id: string
  type: RefundRequestType
  status: RefundRequestStatus
  reason: RefundReason
  amount: string
  requestedAt: string
}

/**
 * Every field on a line is a snapshot taken when the order was paid for. This
 * page never joins to today's catalog, which is why an order still reads
 * correctly after the product has been renamed, repriced or archived.
 */
export type OrderItem = {
  id: string
  /** Null once the variant is gone. The line still renders. */
  slug: string | null
  image: { url: string; altText: string | null } | null
  title: string
  sku: string
  options: { name: string; value: string }[]
  unitPrice: string
  quantity: number
  totalPrice: string
  discountAmount: string
  /** The line as charged: its own discount off, the order-wide share not. */
  discountedTotal: string
  /** The code that discounted this line, snapshotted at purchase. */
  discountCode: string | null
  /**
   * How many of these may still be sent back — quantity less anything already
   * refunded, in-flight refunds included. The return form caps on this rather
   * than on `quantity`, and it is the server's answer, never a computed one.
   */
  returnableQuantity: number
}

export type Order = {
  id: string
  orderNumber: string
  /** Where the parcel is, and whether the money settled — different questions. */
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
  placedAt: string | null
  items: OrderItem[]
  itemCount: number
  subtotal: string
  /**
   * The lines as the item column adds up — each line's own discount already
   * off, the order-wide one not. This is what the summary calls Subtotal, and
   * it matches the checkout the customer read before paying.
   */
  goodsTotal: string
  discountAmount: string
  shippingAmount: string
  /** The delivery service that was paid for, already labelled by the server. */
  shippingMethod: string
  /** The part of `discountAmount` that came off delivery rather than goods. */
  shippingDiscount: string
  /** One entry per code actually spent. Empty when nothing was applied. */
  discounts: OrderDiscount[]
  totalAmount: string
  currency: string
  shippingAddress: {
    fullName: string
    phone: string
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string
    postalCode: string
    country: string
  } | null
  payment: { provider: string; method: string | null; amount: string; paidAt: string } | null
  /**
   * Whether the buttons are drawn — decided by the server, because a client
   * that knows the rules is a second copy of them. Both are hints: the
   * endpoints re-check, since a parcel can ship in the seconds after a render.
   */
  cancellable: boolean
  returnable: boolean
  /** When the return window shuts. Null until something has been delivered. */
  returnWindowEndsAt: string | null
  deliveredAt: string | null
  activeRequest: OrderRequestSummary | null
  refunds: OrderRefund[]
  /** Settled and in-flight together: what the customer is getting back. */
  refundedTotal: string
  /** Customer-facing statuses only, oldest first. */
  timeline: { status: OrderStatus; at: string }[]
  createdAt: string
}

/** The history row: enough to recognise an order, not to audit it. */
export type OrderCard = {
  id: string
  orderNumber: string
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
  placedAt: string | null
  itemCount: number
  totalAmount: string
  refundedTotal: string
  /** So the list can badge an open return without a second request. */
  activeRequest: OrderRequestSummary | null
  thumbnails: ({ url: string; altText: string | null } | null)[]
  createdAt: string
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
  /** The code that took money off this line, or null. At most one per line. */
  discount: { code: string; amount: string } | null
  /** What the line costs after its own discount. */
  discountedTotal: string
}

/**
 * Every money field is a string the server computed (§21). Nothing in the
 * checkout page adds anything up — including the total it puts on the button.
 */
/**
 * One delivery service. `amount` is what *this* order pays for it — the free
 * delivery waiver is already applied — so the page renders the string and never
 * works a charge out for itself (§21).
 */
export type ShippingMethodOption = {
  code: string
  label: string
  eta: string
  amount: string
}

/** A code the customer typed, and what it is worth after allocation. */
export type AppliedDiscount = {
  couponId: string
  code: string
  /** Product discounts are shown against a line; order discounts get a row. */
  kind: 'PRODUCT' | 'ORDER' | 'SHIPPING'
  amount: string
}

export type CheckoutSession = {
  id: string
  status: CheckoutStatus
  /** The deadline. The countdown drawn from it is decoration; this is the rule. */
  expiresAt: string
  items: CheckoutItem[]
  subtotal: string
  discountAmount: string
  /** The codes applied to this checkout, each worth what it won. */
  discounts: AppliedDiscount[]
  /** Every saving on the order: the lines' own, plus any order-wide one. */
  totalDiscount: string
  /** The lines after their discounts — what the summary calls Subtotal. */
  goodsTotal: string
  shippingAmount: string
  /** Taken off the delivery charge; the rate above is what was quoted. */
  shippingDiscount: string
  /** The chosen service's code, and every service priced for this order. */
  shippingMethod: string
  shippingMethods: ShippingMethodOption[]
  totalAmount: string
  currency: string
  shippingAddress: Address | null
  billingAddress: Address | null
  /** Null until the webhook lands. Its arrival is what makes this an order. */
  order: { id: string; orderNumber: string } | null
  /**
   * Who will take the money. The page reads it only to say the right thing
   * before Pay is pressed — what it needs to *actually* pay comes back from
   * `POST /payments` as `clientPayload`, and not a moment earlier.
   */
  paymentProvider: 'razorpay'
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

// ─── home ────────────────────────────────────────────────────────────────────

/**
 * One payload for the whole front page. Everything in it is shaped like
 * something that already exists elsewhere — cards, tiles, categories — because
 * the page is an arrangement, not a new kind of thing.
 */
export type HomePayload = {
  /** Taken from the newest photographed product, not an uploaded asset. */
  hero: { image: { url: string; altText: string | null } | null }
  categories: { id: string; name: string; slug: string; image: string | null }[]
  /** The marquee band: a backdrop, and every leaf category and live collection. */
  topCategories: {
    image: string | null
    links: { id: string; label: string; to: string }[]
  }
  collections: {
    id: string
    name: string
    slug: string
    description: string | null
    image: string | null
  }[]
  newArrivals: ProductCard[]
  onSale: ProductCard[]
  /**
   * Curated quotes an admin publishes — not product reviews. A review is one
   * customer's opinion of one product and lives on that product's page.
   */
  testimonials: {
    id: string
    quote: string
    authorName: string
    authorRole: string | null
    rating: number | null
    imageUrl: string | null
  }[]
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

