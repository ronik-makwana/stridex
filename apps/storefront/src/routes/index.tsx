import { createBrowserRouter } from 'react-router'
import { ShopLayout } from '@/layouts/ShopLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { RedirectIfAuthenticated, RequireAuth } from '@/components/require-auth'
import HomePage from './home'
import ProductPage from './product'
import NotFoundPage from './not-found'
import LoginPage from './auth/login'
import RegisterPage from './auth/register'
import ForgotPasswordPage from './auth/forgot-password'
import ResetPasswordPage from './auth/reset-password'
import VerifyEmailPage from './auth/verify-email'
import AccountPage from './account'

/**
 * Route tree per `shoe-storefront-final-spec.md` §3.15. Only the Phase 11 paths
 * are mounted; the catalog, cart and checkout routes land with the phases that
 * build them, so a half-built screen is never reachable from a URL.
 *
 * Three groups, and the nesting is what enforces them:
 *   - `/verify-email` is public even to a signed-in customer, because the link
 *     is opened from an inbox in whatever browser happens to be default.
 *   - `/login`, `/register` and the password flows bounce a signed-in customer
 *     away — there is nothing for them to do there.
 *   - `/account/*` and, from Phase 15, `/checkout` sit behind RequireAuth.
 */
export const router = createBrowserRouter([
  {
    element: <ShopLayout />,
    children: [
      { index: true, element: <HomePage /> },

      { path: 'p/:slug', element: <ProductPage /> },

      // Phase 13: /c/:slug, /collections, /collections/:slug, /search
      // Phase 14: /cart, /wishlist

      {
        element: <RequireAuth />,
        children: [
          { path: 'account', element: <AccountPage /> },
          // Phase 15: /checkout   Phase 16: /account/orders, /account/addresses
        ],
      },

      // Last in this group: it matches anything the routes above did not.
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    // The auth screens get their own chrome-free layout, so they sit outside
    // ShopLayout rather than inside it.
    element: <AuthLayout />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
          { path: 'reset-password', element: <ResetPasswordPage /> },
        ],
      },
      /*
       * `/register` is deliberately NOT under RedirectIfAuthenticated. A
       * successful signup creates a session, so that guard would fire on the
       * app's own success and redirect away from the "check your inbox" screen
       * the spec requires registration to end on. The page makes the
       * already-signed-in check itself, against the state it had on mount.
       */
      { path: 'register', element: <RegisterPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
    ],
  },
])
