import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/features/auth/api'
import { cartKeys, mergeGuestCart } from '@/features/cart/use-cart'
import { mergeGuestWishlist, wishlistKeys } from '@/features/wishlist/use-wishlist'
import { refreshSession } from '@/lib/api-client'
import type { RegisterValues } from '@/features/auth/schemas'
import type { ShopUser } from '@/types/api'
import {
  clearSession,
  getCurrentUser,
  onSessionExpired,
  setAccessToken,
  setCurrentUser,
} from './auth-store'

/**
 * `guest` is a first-class state here, not a failure. That is the substantive
 * difference from the admin app: there, being signed out means something went
 * wrong; here it is how most visitors arrive, browse, and fill a cart. Nothing
 * in this provider may treat it as an error.
 */
type AuthStatus = 'loading' | 'authenticated' | 'guest'

type AuthContextValue = {
  user: ShopUser | null
  status: AuthStatus
  /** Convenience: `status === 'authenticated'`. */
  isAuthenticated: boolean
  /** True only after a live session died mid-use, never on a cold start. */
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<ShopUser>
  register: (values: RegisterValues) => Promise<{ user: ShopUser; verificationEmailSent: boolean }>
  logout: () => Promise<void>
  /** Re-reads the account, e.g. after the customer verifies their email. */
  reloadUser: () => Promise<void>
  dismissSessionExpired: () => void
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = React.useState<ShopUser | null>(getCurrentUser())
  const [status, setStatus] = React.useState<AuthStatus>('loading')
  const [sessionExpired, setSessionExpired] = React.useState(false)

  // `status` is read inside the session-expired listener but must not re-subscribe
  // it on every change, so the listener reads a ref rather than closing over state.
  const statusRef = React.useRef(status)
  statusRef.current = status

  // Cold start: the access token died with the last page, but the httpOnly
  // refresh cookie did not. One refresh call decides whether this is a returning
  // customer or a guest.
  React.useEffect(() => {
    let cancelled = false

    // Single-flighted: StrictMode mounts this effect twice, and two concurrent
    // refreshes with the same cookie is exactly what the server reads as reuse.
    refreshSession()
      .then((session) => {
        if (cancelled) return
        setAccessToken(session.accessToken)
        setCurrentUser(session.user)
        setUser(session.user)
        setStatus('authenticated')
      })
      .catch(() => {
        // Expected for every first-time visitor. Not logged, not surfaced.
        if (cancelled) return
        clearSession()
        setUser(null)
        setStatus('guest')
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The axios interceptor fires this when a refresh fails mid-session.
  React.useEffect(
    () =>
      onSessionExpired(() => {
        // Only worth telling someone about if they were actually signed in.
        // On a public page a failed refresh is just a guest, and a modal about
        // it would be alarming and wrong.
        const wasSignedIn = statusRef.current === 'authenticated'
        setUser(null)
        setStatus('guest')
        if (wasSignedIn) setSessionExpired(true)
      }),
    [],
  )

  /**
   * Everything the guest was carrying, handed to the account they just signed
   * into. Runs on register as well as login — someone who fills a cart and then
   * creates an account is the common path, not the edge case.
   *
   * Deliberately not allowed to fail the sign-in. If a merge request dies the
   * customer is still signed in, and local storage is left untouched so the
   * cart is still there to merge on the next attempt.
   */
  const afterAuth = React.useCallback(async () => {
    const results = await Promise.allSettled([mergeGuestCart(), mergeGuestWishlist()])
    if (results[0].status === 'fulfilled' && results[0].value) {
      queryClient.setQueryData(cartKeys.server(), results[0].value)
    }
    if (results[1].status === 'fulfilled' && results[1].value) {
      queryClient.setQueryData(wishlistKeys.server(), results[1].value)
    }
    // Both hooks switch query keys the moment `status` flips, so anything that
    // did not merge cleanly is refetched rather than left stale.
    void queryClient.invalidateQueries({ queryKey: cartKeys.all })
    void queryClient.invalidateQueries({ queryKey: wishlistKeys.all })
  }, [queryClient])

  /**
   * The one place a new session is adopted — which is why the merge hangs here
   * rather than in the login and register screens, where a second copy would
   * drift the day one of them grows a redirect.
   */
  const adoptSession = React.useCallback((session: { user: ShopUser; accessToken: string }) => {
    setAccessToken(session.accessToken)
    setCurrentUser(session.user)
    setUser(session.user)
    setStatus('authenticated')
    setSessionExpired(false)
    void afterAuth()
    return session.user
  }, [afterAuth])

  const login = React.useCallback(
    async (email: string, password: string) => adoptSession(await authApi.login({ email, password })),
    [adoptSession],
  )

  const register = React.useCallback(
    async (values: RegisterValues) => {
      const session = await authApi.register(values)
      return {
        user: adoptSession(session),
        verificationEmailSent: session.verificationEmailSent,
      }
    },
    [adoptSession],
  )

  const logout = React.useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      // Even if the call fails, drop the local session — and the cache with it,
      // or the next person on this browser sees the last person's orders.
      clearSession()
      setUser(null)
      setStatus('guest')
      setSessionExpired(false)
      queryClient.clear()
    }
  }, [queryClient])

  const reloadUser = React.useCallback(async () => {
    // Only meaningful for a signed-in customer; a guest has nothing to reload
    // and the call would 401 and trip the interceptor for nothing.
    if (statusRef.current !== 'authenticated') return
    const fresh = await authApi.me()
    setCurrentUser(fresh)
    setUser(fresh)
  }, [])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      sessionExpired,
      login,
      register,
      logout,
      reloadUser,
      dismissSessionExpired: () => setSessionExpired(false),
    }),
    [user, status, sessionExpired, login, register, logout, reloadUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
