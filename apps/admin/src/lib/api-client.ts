import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { ApiErrorBody, AuthSession } from '@/types/api'
import {
  clearSession,
  emitSessionExpired,
  getAccessToken,
  setAccessToken,
  setCurrentUser,
} from './auth-store'

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/admin'

export const api = axios.create({
  baseURL,
  // Required: the refresh token is an httpOnly cookie, so every request that
  // might refresh has to be allowed to carry it.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

/** A typed error the UI can branch on without touching axios internals. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>
  readonly reason?: string

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.fields = body.fields
    this.reason = body.reason
  }

  /** `409` on a slug/SKU, or a 400 with field messages: render inline. */
  get isFieldError() {
    return Boolean(this.fields && Object.keys(this.fields).length)
  }
}

function toApiError(error: AxiosError<ApiErrorBody>): ApiError {
  const status = error.response?.status ?? 0
  const body = error.response?.data?.error
  if (body) return new ApiError(status, body)

  if (error.code === 'ECONNABORTED') {
    return new ApiError(0, { code: 'TIMEOUT', message: 'The request timed out' })
  }
  return new ApiError(status, {
    code: 'NETWORK_ERROR',
    message: status ? error.message : 'Cannot reach the server',
  })
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
    // Remembered so a 401 can tell "my token expired" from "my token was
    // already replaced while this request was in flight".
    ;(config as RetriableConfig)._sentWith = token
  }
  return config
})

// ─── refresh, single-flighted ────────────────────────────────────────────────
//
// Ten queries can fail with 401 in the same tick when an access token expires.
// Without this, that is ten refresh calls, nine of which arrive with a token
// the first one already rotated away — and the server reads that as reuse and
// kills the session. One in-flight promise, everyone else awaits it.

type RetriableConfig = AxiosRequestConfig & { _retried?: boolean; _sentWith?: string }

let refreshPromise: Promise<AuthSession> | null = null

/** Endpoints that must never trigger a refresh, or a failure would recurse. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/reset-password']

const isAuthEndpoint = (url?: string) =>
  Boolean(url && AUTH_ENDPOINTS.some((path) => url.startsWith(path)))

async function performRefresh(): Promise<AuthSession> {
  // A bare axios call, not `api`: the interceptors below must not see it.
  const { data } = await axios.post<{ data: AuthSession }>(
    `${baseURL}/auth/refresh`,
    {},
    { withCredentials: true },
  )
  setAccessToken(data.data.accessToken)
  setCurrentUser(data.data.user)
  return data.data
}

/**
 * The only way anything should ever call /auth/refresh. Rotation is
 * destructive: two concurrent calls send the same cookie, the first rotates it,
 * and the server reads the second as token reuse and kills the session. React
 * StrictMode's double-mount alone is enough to cause that, so app bootstrap
 * goes through here too, not through `authApi.refresh()`.
 */
export function refreshSession(): Promise<AuthSession> {
  refreshPromise ??= performRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as (RetriableConfig & InternalAxiosRequestConfig) | undefined
    const status = error.response?.status

    const shouldRefresh =
      status === 401 && config && !config._retried && !isAuthEndpoint(config.url)

    if (!shouldRefresh) return Promise.reject(toApiError(error))

    config._retried = true

    try {
      // The in-flight promise only dedupes calls that overlap. Ten requests
      // sent together do not all fail together: the stragglers' 401s land
      // *after* the first refresh already finished, and each would start
      // another one. If the stored token has changed since this request was
      // signed, the 401 is stale — retry with the current token, no refresh.
      const current = getAccessToken()
      const token =
        current && current !== config._sentWith
          ? current
          : (await refreshSession()).accessToken

      config.headers.set('Authorization', `Bearer ${token}`)
      return await api.request(config)
    } catch {
      // The refresh itself failed: the session is genuinely gone. Tell React so
      // it can show the session-expired modal instead of silently blanking.
      clearSession()
      emitSessionExpired()
      return Promise.reject(toApiError(error))
    }
  },
)

/** Unwraps `{ data }` so callers work with the payload directly. */
export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.get<{ data: T }>(url, config)
  return response.data.data
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.post<{ data: T }>(url, body, config)
  return response.data.data
}

/** Full replace. Used where a partial update would be ambiguous — see discounts. */
export async function put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.put<{ data: T }>(url, body, config)
  return response.data.data
}

export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.patch<{ data: T }>(url, body, config)
  return response.data.data
}

export async function del<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.delete<{ data: T }>(url, config)
  return response.data?.data
}
