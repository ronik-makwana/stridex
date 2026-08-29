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
