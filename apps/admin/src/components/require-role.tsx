import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/lib/auth'
import { FullPageSpinner } from '@/components/ui/spinner'
import type { UserRole } from '@/types/api'

/**
 * Route guard. `loading` must render a spinner rather than redirecting, or a
 * hard refresh bounces a signed-in admin to /login before the bootstrap
 * refresh has had a chance to answer.
 */
export function RequireRole({ roles }: { roles?: UserRole[] }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner label="Restoring your session" />

  if (status === 'unauthenticated' || !user) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (roles && !roles.includes(user.role)) return <Navigate to="/403" replace />

  return <Outlet />
}

/** The mirror image: keeps a signed-in admin out of /login. */
export function RedirectIfAuthenticated() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner label="Restoring your session" />
  if (status === 'authenticated') {
    const from = (location.state as { from?: Location } | null)?.from
    return <Navigate to={from?.pathname ?? '/'} replace />
  }
  return <Outlet />
}
