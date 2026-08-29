import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/features/auth/api'
import { refreshSession } from '@/lib/api-client'
import type { AdminUser, UserRole } from '@/types/api'
import {
  clearSession,
  getCurrentUser,
  onSessionExpired,
  setAccessToken,
  setCurrentUser,
} from './auth-store'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  user: AdminUser | null
  status: AuthStatus
  /** True only after a live session died mid-use, never on a cold start. */
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<AdminUser>
  logout: () => Promise<void>
  dismissSessionExpired: () => void
  hasRole: (...roles: UserRole[]) => boolean
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = React.useState<AdminUser | null>(getCurrentUser())
  const [status, setStatus] = React.useState<AuthStatus>('loading')
  const [sessionExpired, setSessionExpired] = React.useState(false)

  // Cold start: the access token died with the last page, but the httpOnly
  // refresh cookie did not. One refresh call decides whether we are logged in.
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
        if (cancelled) return
        clearSession()
        setUser(null)
        setStatus('unauthenticated')
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The axios interceptor fires this when a refresh fails mid-session.
  React.useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null)
        // Only a modal-worthy event if we were actually signed in; otherwise a
        // failed refresh on a public page would pop a scary dialog for nothing.
        setSessionExpired((wasExpired) => wasExpired || status === 'authenticated')
        setStatus('unauthenticated')
      }),
    [status],
  )

  const login = React.useCallback(
    async (email: string, password: string) => {
      const session = await authApi.login({ email, password })
      setAccessToken(session.accessToken)
      setCurrentUser(session.user)
      setUser(session.user)
      setStatus('authenticated')
      setSessionExpired(false)
      return session.user
    },
    [],
  )

  const logout = React.useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      // Even if the call fails, drop the local session — and the cache with it,
      // or the next person to sign in sees the last person's data.
      clearSession()
      setUser(null)
      setStatus('unauthenticated')
      setSessionExpired(false)
      queryClient.clear()
    }
  }, [queryClient])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      sessionExpired,
      login,
      logout,
      dismissSessionExpired: () => setSessionExpired(false),
      hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
    }),
    [user, status, sessionExpired, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
