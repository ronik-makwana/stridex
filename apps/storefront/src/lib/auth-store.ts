import type { ShopUser } from '@/types/api'

/**
 * The access token lives here and only here: a module variable, never
 * localStorage and never a readable cookie. It dies with the tab, and XSS
 * cannot read it out of storage after the fact. The refresh token is an
 * httpOnly cookie, so a reload restores the session by calling /auth/refresh
 * rather than by reading a credential off disk.
 *
 * Note what is *not* here: the cart. A guest cart is variant ids and quantities
 * in localStorage (`local-cart.ts`, Phase 14) and deliberately survives both a
 * reload and a logout — it is a wish, not a credential.
 */
let accessToken: string | null = null
let currentUser: ShopUser | null = null

export const getAccessToken = () => accessToken
export const setAccessToken = (token: string | null) => {
  accessToken = token
}

export const getCurrentUser = () => currentUser
export const setCurrentUser = (user: ShopUser | null) => {
  currentUser = user
}

export function clearSession() {
  accessToken = null
  currentUser = null
}

/**
 * How the axios interceptor tells React that a refresh failed. A plain DOM
 * event keeps `api-client.ts` free of React imports, so it stays callable from
 * anywhere — loaders, plain functions, the cart hydrate on boot.
 */
export const SESSION_EXPIRED_EVENT = 'stridex-shop:session-expired'

export function emitSessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

export function onSessionExpired(handler: () => void) {
  window.addEventListener(SESSION_EXPIRED_EVENT, handler)
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler)
}
