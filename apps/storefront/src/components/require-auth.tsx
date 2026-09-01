import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { useAuth } from '@/lib/auth'
import { loginPathFor, safeRedirect } from '@/lib/redirect'
import { FullPageSpinner } from '@/components/ui/spinner'

/**
 * The auth wall. It sits on checkout, orders and account — never on browsing,
 * the cart or the wishlist, which stay public through Phase 14.
 *
 * `loading` must render a spinner rather than redirect, or a hard refresh
 * bounces a signed-in customer to /login before the bootstrap refresh has had a
 * chance to answer.
 *
 * This is a routing convenience, not access control. Every endpoint behind it
 * checks the token and the ownership of the record itself (§22); hiding a route
 * protects nothing.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner label="One moment" />

  if (status !== 'authenticated') {
    // `replace` so Back does not bounce between the guarded page and login.
    return <Navigate to={loginPathFor(location.pathname, location.search)} replace />
  }

  return <Outlet />
}

/**
 * The mirror image: keeps a signed-in customer out of /login and /register.
 *
 * It honours `?redirect=` rather than always sending them home. A customer who
 * clicks Sign in from checkout in a second tab, having signed in already in the
 * first, should land on checkout — dropping them on the home page makes them
 * navigate back to a cart they had already finished with.
 */
export function RedirectIfAuthenticated() {
  const { status } = useAuth()
  const [params] = useSearchParams()

  if (status === 'loading') return <FullPageSpinner label="One moment" />
  if (status === 'authenticated') {
    // Validated, not trusted: this param reaches a navigation either way, so it
    // gets the same open-redirect check the login form applies.
    return <Navigate to={safeRedirect(params.get('redirect'))} replace />
  }
  return <Outlet />
}
