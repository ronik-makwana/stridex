import type { AdminUser } from '@/types/api'

/**
 * The access token lives here and only here: a module variable, never
 * localStorage or a readable cookie. It dies with the tab, and XSS cannot read
 * it out of storage after the fact. The refresh cookie is httpOnly, so a page
 * reload restores the session by calling /auth/refresh rather than by reading
 * a token off disk.
 */
let accessToken: string | null = null
let currentUser: AdminUser | null = null

export const getAccessToken = () => accessToken
export const setAccessToken = (token: string | null) => {
  accessToken = token
}

export const getCurrentUser = () => currentUser
export const setCurrentUser = (user: AdminUser | null) => {
  currentUser = user
}

export function clearSession() {
  accessToken = null
  currentUser = null
}

/**
 * How the axios interceptor tells React that the refresh failed. A plain event
 * keeps `api-client.ts` free of React imports, so it stays usable from
 * anywhere, including loaders and plain functions.
 */
export const SESSION_EXPIRED_EVENT = 'shoe-admin:session-expired'

export function emitSessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

export function onSessionExpired(handler: () => void) {
  window.addEventListener(SESSION_EXPIRED_EVENT, handler)
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler)
}
