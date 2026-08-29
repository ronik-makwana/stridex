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
}

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
