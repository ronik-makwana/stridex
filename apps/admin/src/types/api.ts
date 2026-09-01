// Hand-written admin request/response types. Deliberately not shared with the
// storefront: see repo-structure.md. Once the API exposes an OpenAPI document,
// `npm run gen:api` regenerates this file in place.

export type UserRole = 'ADMIN' | 'STAFF' | 'CUSTOMER'
export type UserStatus = 'ACTIVE' | 'SUSPENDED'

export type AdminUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  phone: string | null
  role: UserRole
  status: UserStatus
  emailVerifiedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Shared across brands, categories, products, variants and collections. */
export type EntityStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

export type Brand = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  status: EntityStatus
  productCount: number
  createdAt: string
  updatedAt: string
}

export type BrandListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  status?: EntityStatus
}

// ─── categories ──────────────────────────────────────────────────────────────

/** How deep the tree is allowed to go. Mirrors `MAX_CATEGORY_DEPTH` on the API. */
export const MAX_CATEGORY_DEPTH = 4

export type CategoryAncestor = {
  id: string
  name: string
  slug: string
}

export type Category = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  /** 0-based, derived server side from the parent. Never sent on a write. */
  level: number
  /** Order among its siblings only. Changed by dragging, never by the form. */
  position: number
  status: EntityStatus
  /** Products sitting directly in this category — what a delete is blocked on. */
  productCount: number
  /** Including every descendant. What the tree shows beside a branch. */
  totalProductCount: number
  childCount: number
  /** Root first, self excluded. */
  ancestors: CategoryAncestor[]
  /** 'Shoes > Men > Running'. */
  path: string
  /** Only the tree endpoint nests them; `null` everywhere else. */
  children: Category[] | null
  createdAt: string
  updatedAt: string
}

export type CategoryListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  status?: EntityStatus
  /** 'root' for the top level, or a category id for its direct children. */
  parentId?: string
}

/** One dropped node: where it landed and under whom. `null` is the top level. */
export type CategoryMove = {
  id: string
  parentId: string | null
  position: number
}

// ─── attributes ──────────────────────────────────────────────────────────────

export type AttributeType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT' | 'MULTI_SELECT'

/** The two types that hold a value list. The rest store the value on the product. */
export const LIST_ATTRIBUTE_TYPES: AttributeType[] = ['SELECT', 'MULTI_SELECT']

export const isListAttributeType = (type: AttributeType) => LIST_ATTRIBUTE_TYPES.includes(type)

export type AttributeValue = {
  id: string
  attributeId: string
  value: string
  slug: string
  position: number
  /** Distinct products holding this value — what a delete would break. */
  productCount: number
  createdAt: string
}

export type Attribute = {
  id: string
  name: string
  slug: string
  type: AttributeType
  /** NUMBER only: the suffix shown after the value, e.g. 'g'. */
  unit: string | null
  isFilterable: boolean
  isSuggested: boolean
  position: number
  valueCount: number
  productCount: number
  /** `null` on the list endpoint — values are only loaded by the detail one. */
  values: AttributeValue[] | null
  createdAt: string
  updatedAt: string
}

export type AttributeListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  type?: AttributeType
  /** The URL carries 'true'/'false'; the API accepts either form. */
  isFilterable?: boolean | 'true' | 'false'
  /** Nests each attribute's values. The product editor needs them; the list does not. */
  withValues?: boolean | 'true' | 'false'
}

// ─── variant options ─────────────────────────────────────────────────────────

export type VariantOptionValue = {
  id: string
  variantOptionId: string
  value: string
  slug: string
  /** '#RRGGBB' or null. Drives the storefront colour swatches. */
  swatchHex: string | null
  position: number
  /** Variants already built on this value — what a delete would break. */
  variantCount: number
  createdAt: string
}

export type VariantOption = {
  id: string
  name: string
  slug: string
  position: number
  valueCount: number
  productCount: number
  /** `null` on the list endpoint — values are only loaded by the detail one. */
  values: VariantOptionValue[] | null
  createdAt: string
  updatedAt: string
}

export type VariantOptionListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  /** Nests each option's values. The product editor needs them; the list does not. */
  withValues?: boolean | 'true' | 'false'
}

// ─── products ────────────────────────────────────────────────────────────────

export type MediaType = 'IMAGE' | 'VIDEO'

export type ProductMedia = {
  id: string
  productId: string
  url: string
  altText: string | null
  type: MediaType
  sortOrder: number
  /** Position 0. Derived server side, so there is one source of truth. */
  isCover: boolean
  createdAt: string
}

/**
 * One attribute row on a product, flattened. The editor picks a control from
 * `type` and labels the input with `unit`, so the definition rides along rather
 * than being looked up per row.
 */
export type ProductAttributeRow = {
  id: string
  attributeId: string
  name: string
  slug: string
  type: AttributeType
  unit: string | null
  isFilterable: boolean
  attributeValueId: string | null
  /** The chosen option's label, for SELECT and MULTI_SELECT. */
  valueLabel: string | null
  valueText: string | null
  /** Decimal, as a fixed-point string — never a float. */
  valueNumber: string | null
  valueBoolean: boolean | null
  position: number
}

/** An option this product builds variants from, with every value it offers. */
export type ProductVariantOptionRow = {
  id: string
  variantOptionId: string
  name: string
  slug: string
  /** 0-based. Drives the Option 1 / Option 2 labels and the SKU token order. */
  position: number
  values: {
    id: string
    value: string
    slug: string
    swatchHex: string | null
    position: number
  }[]
}

export type VariantStock = {
  quantity: number
  reserved: number
  available: number
  lowStockThreshold: number
}

export type ProductVariant = {
  id: string
  productId: string
  sku: string
  barcode: string | null
  /** Money is a fixed-point string end to end. Parse only to display. */
  price: string
  compareAtPrice: string | null
  mediaId: string | null
  position: number
  status: EntityStatus
  stock: VariantStock
  options: {
    optionValueId: string
    variantOptionId: string
    optionName: string | null
    value: string
    swatchHex: string | null
  }[]
  createdAt: string
  updatedAt: string
}

export type ProductRef = { id: string; name: string; slug: string }

/** A tag as it appears on a product. Created by typing one; there is no editor. */
export type Tag = {
  id: string
  name: string
  slug: string
  /** How many products wear it. 0 everywhere except the suggestion list. */
  productCount: number
}

export type ProductTagRef = { id: string; name: string; slug: string }

/** Manual collections only — a dynamic one's membership is not editable here. */
export type ProductCollectionRef = {
  id: string
  name: string
  slug: string
  status: EntityStatus
}

export type Product = {
  id: string
  title: string
  slug: string
  description: string | null
  status: EntityStatus
  publishedAt: string | null

  brandId: string | null
  brand: ProductRef | null
  categoryId: string | null
  category: ProductRef | null
  /** 'Shoes > Men > Running'. */
  categoryPath: string | null

  coverUrl: string | null
  mediaCount: number
  variantCount: number
  /** Summed available across variants. Red at zero, even when active. */
  totalStock: number

  /** `null` on the list endpoint — only the detail one loads these six. */
  media: ProductMedia[] | null
  attributes: ProductAttributeRow[] | null
  variantOptions: ProductVariantOptionRow[] | null
  variants: ProductVariant[] | null
  tags: ProductTagRef[] | null
  collections: ProductCollectionRef[] | null

  createdAt: string
  updatedAt: string
}

export type StockFilter = 'in' | 'low' | 'out'

export type ProductListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  status?: EntityStatus
  brandId?: string
  categoryId?: string
  stock?: StockFilter
  /** The URL carries 'true'/'false'; the API accepts either form. */
  missingMedia?: boolean | 'true' | 'false'
}

export type PublishCheck = {
  key: string
  label: string
  passed: boolean
  detail?: string
}

export type PublishChecklist = { checks: PublishCheck[]; ready: boolean }

/** What a dry run reports before anything is written. */
export type GenerateResult = {
  added: number
  kept: number
  removed: number
  preview: {
    key: string
    sku: string
    options: { optionName: string; value: string }[]
    isNew: boolean
  }[]
  /** Combinations outside the selection that cannot be removed — they have sold. */
  blocked: { sku: string; reason: string }[]
  applied: boolean
}

export type BulkResult = {
  updated: number
  skipped: { id: string; title: string; reason: string }[]
}

/** What a presign hands back. The browser PUTs to `uploadUrl`, then records `key`. */
export type PresignedUpload = { uploadUrl: string; key: string; url: string }

// ─── inventory ───────────────────────────────────────────────────────────────

export type InventoryTransactionType =
  | 'RESTOCK'
  | 'SALE'
  | 'RESERVATION'
  | 'RELEASE'
  | 'RETURN'
  | 'ADJUSTMENT'

/**
 * One sellable SKU and its three numbers. All three go out because admin is the
 * one audience allowed to see them — "0 available against 20 on hand" is
 * nonsense until the reservations underneath are visible.
 */
export type InventoryRow = {
  variantId: string
  inventoryId: string | null
  sku: string
  barcode: string | null
  status: EntityStatus

  productId: string
  product: { id: string; title: string; slug: string; status: EntityStatus } | null
  brand: ProductRef | null
  /** 'Black / 9'. The only thing telling two SKUs of one product apart. */
  optionLabel: string | null

  quantity: number
  reserved: number
  /** quantity − reserved. Computed server side, never stored. */
  available: number
  lowStockThreshold: number
  isOut: boolean
  isLow: boolean

  updatedAt: string
}

export type InventoryTransaction = {
  id: string
  type: InventoryTransactionType
  /** Signed — the ledger has to sum to the number on the inventory row. */
  quantity: number
  /** 'Damaged', 'Restock'. Derived from the reference token, not the type. */
  reason: string | null
  referenceType: string | null
  referenceId: string | null
  note: string | null
  /** Null means the system wrote it — checkout, or a webhook. */
  createdBy: { id: string; email: string; name: string | null } | null
  createdAt: string

  /** Only the global ledger carries these; the per-variant one already knows. */
  variantId: string | null
  sku: string | null
  product: { id: string; title: string; slug: string } | null
}

export type InventoryListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  brandId?: string
  categoryId?: string
  stock?: StockFilter
  /** Low-stock view only: judge every row against this instead of its own. */
  threshold?: number
}

export type TransactionListQuery = {
  page?: number
  limit?: number
  q?: string
  type?: InventoryTransactionType
  variantId?: string
  from?: string
  to?: string
}

/** Served by the API so the client cannot drift from the ledger's own types. */
export type AdjustReason = {
  value: string
  label: string
  type: InventoryTransactionType
}

export type AdjustStockInput = {
  mode: 'set' | 'change'
  value: number
  reason: string
  note?: string | null
}

export type RestockInput = {
  quantity: number
  reference?: string | null
  note?: string | null
}

// ─── collections ─────────────────────────────────────────────────────────────

export type CollectionType = 'MANUAL' | 'DYNAMIC'
export type MatchType = 'ALL' | 'ANY'

export type RuleOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'

/** What control the builder draws, and what the rule's value means. */
export type RuleFieldKind =
  | 'category'
  | 'brand'
  | 'tag'
  | 'money'
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'attribute-select'
  | 'attribute-text'
  | 'attribute-number'
  | 'attribute-boolean'

/**
 * Served by the API rather than hard-coded here. Attributes are data, so the
 * field list grows when the catalogue does — a client copy would start posting
 * rules the engine rejects the first time somebody adds one.
 */
export type RuleFieldDefinition = {
  field: string
  label: string
  kind: RuleFieldKind
  operators: RuleOperator[]
  /** Attribute select and tag fields — the values the picker offers. */
  values?: { id: string; label: string }[]
  unit?: string | null
}

export type CollectionRule = {
  id: string
  field: string
  operator: RuleOperator
  /** Meaning depends entirely on the field: a uuid, a number, an ISO date. */
  value: string | number | boolean | null
  groupId: number
}

/** What the builder holds before anything is saved. */
export type RuleDraft = {
  field: string
  operator: RuleOperator
  value: string | number | boolean | null
}

export type Collection = {
  id: string
  name: string
  slug: string
  description: string | null
  imageUrl: string | null
  type: CollectionType
  matchType: MatchType
  status: EntityStatus
  /**
   * Manual: the pinned list's length. Dynamic: how many products the rules
   * match right now — a number that moves without anyone editing it.
   */
  productCount: number
  /** `null` on the list endpoint — rules are only loaded by the detail one. */
  rules: CollectionRule[] | null
  products: Product[] | null
  /** A rule pointing at something deleted. Shown, never swallowed. */
  ruleError: string | null
  createdAt: string
  updatedAt: string
}

export type CollectionListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  type?: CollectionType
  status?: EntityStatus
}

export type RulePreview = { count: number; sample: Product[] }

export type AuthSession = {
  user: AdminUser
  accessToken: string
}

// ─── orders and payments ─────────────────────────────────────────────────────

export type OrderStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'
export type OrderPaymentStatus = 'PENDING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED'
export type PaymentRecordStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'VOIDED'

export type OrderCustomer = { id: string; email: string; name: string | null }

/** The list row: two status columns, because they answer different questions. */
export type OrderRow = {
  id: string
  orderNumber: string
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
  customer: OrderCustomer | null
  itemCount: number
  totalAmount: string
  currency: string
  placedAt: string | null
  createdAt: string
}

/** Every line is what was charged, not what the product costs today. */
export type OrderItemRow = {
  id: string
  variantId: string | null
  productTitle: string
  sku: string
  variantOptions: { name: string; value: string }[]
  unitPrice: string
  quantity: number
  totalPrice: string
  discountAmount: string
  orderDiscountAllocated: string
}

export type OrderAddress = {
  fullName: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  country: string
}

export type OrderHistoryEntry = {
  id: string
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  note: string | null
  /** Null for the rows the webhook wrote — those are the system's. */
  changedBy: { id: string; name: string | null } | null
  createdAt: string
}

export type Order = OrderRow & {
  items: OrderItemRow[]
  subtotal: string
  discountAmount: string
  shippingAmount: string
  taxAmount: string
  shippingAddress: OrderAddress | null
  billingAddress: OrderAddress | null
  payments: {
    id: string
    provider: string
    providerPaymentId: string
    method: string | null
    amount: string
    status: PaymentRecordStatus
    createdAt: string
  }[]
  history: OrderHistoryEntry[]
  /** Served by the API: the modal never has to know the state machine. */
  allowedTransitions: { to: OrderStatus; backwards: boolean }[]
  updatedAt: string
}

export type OrderListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  status?: OrderStatus
  paymentStatus?: OrderPaymentStatus
  from?: string
  to?: string
}

export type PaymentTransaction = {
  id: string
  type: 'AUTHORIZATION' | 'CAPTURE' | 'REFUND' | 'VOID'
  amount: string
  providerTransactionId: string | null
  createdAt: string
}

export type PaymentRow = {
  id: string
  provider: string
  providerPaymentId: string
  method: string | null
  amount: string
  currency: string
  status: PaymentRecordStatus
  order: { id: string; orderNumber: string } | null
  createdAt: string
}

export type Payment = PaymentRow & {
  hasIdempotencyKey: boolean
  transactions: PaymentTransaction[]
  /** Verbatim, and kept collapsed in the UI: evidence, not a summary. */
  providerResponse: unknown
  updatedAt: string
}

export type PaymentListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  status?: PaymentRecordStatus
  provider?: string
}

// ─── customers and dashboard ─────────────────────────────────────────────────

export type CustomerStatus = 'ACTIVE' | 'SUSPENDED'

export type Customer = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  name: string | null
  phone: string | null
  status: CustomerStatus
  /** Derived from `email_verified_at`, not a column of its own. */
  emailVerified: boolean
  emailVerifiedAt: string | null
  orderCount: number
  /** PAID orders only. A failed checkout is not money anybody spent. */
  totalSpent: string
  createdAt: string
  updatedAt: string
}

export type CustomerListQuery = {
  page?: number
  limit?: number
  sort?: string
  q?: string
  status?: CustomerStatus
  verified?: boolean | 'true' | 'false'
}

export type CustomerAddress = {
  id: string
  fullName: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  country: string
  postalCode: string
  isDefault: boolean
  createdAt: string
}

export type CustomerBasket = {
  cart: {
    id: string
    variantId: string
    title: string
    slug: string
    sku: string
    quantity: number
    price: string
    addedAt: string
  }[]
  wishlist: { id: string; productId: string; title: string; slug: string; savedAt: string }[]
}

export type CustomerSession = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  expiresAt: string
}

export type DashboardSummary = {
  revenue: { value: string; orderCount: number; changePercent: number | null }
  orders: { value: number; changePercent: number | null }
  products: { value: number; drafts: number }
  customers: { value: number; changePercent: number | null }
  window: { from: string; to: string }
}

export type SalesPoint = { at: string; revenue: string; orders: number }

export type RecentOrder = {
  id: string
  orderNumber: string
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
  totalAmount: string
  customer: string
  createdAt: string
}

export type LowStockRow = {
  variantId: string
  productId: string
  title: string
  sku: string
  available: number
  threshold: number
}

export type TopProduct = { title: string; sku: string; units: number; revenue: string }

/** Each line links to the pre-filtered list that shows exactly those rows. */
export type AttentionLine = { key: string; count: number; label: string; to: string }

export type SearchHit = { id: string; label: string; hint: string; to: string }
export type SearchResults = {
  products: SearchHit[]
  orders: SearchHit[]
  customers: SearchHit[]
}

/** Every successful response is wrapped in `data`; lists add `meta`. */
export type ApiResponse<T> = { data: T }

export type ListMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type ApiListResponse<T> = { data: T[]; meta: ListMeta }

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
    reason?: string
  }
}
