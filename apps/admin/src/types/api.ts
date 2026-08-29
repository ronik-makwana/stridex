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

  /** `null` on the list endpoint — only the detail one loads these four. */
  media: ProductMedia[] | null
  attributes: ProductAttributeRow[] | null
  variantOptions: ProductVariantOptionRow[] | null
  variants: ProductVariant[] | null

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

export type AuthSession = {
  user: AdminUser
  accessToken: string
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
