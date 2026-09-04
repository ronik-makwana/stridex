import { createBrowserRouter } from 'react-router'
import { RootLayout } from '@/layouts/RootLayout'
import { ShopLayout } from '@/layouts/ShopLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { CheckoutLayout } from '@/layouts/CheckoutLayout'
import { AccountLayout } from '@/layouts/AccountLayout'
import { RedirectIfAuthenticated, RequireAuth } from '@/components/require-auth'
import HomePage from './home'
import NotFoundPage from './not-found'
import { lazyRoute } from './lazy-route'
import { RouteError } from './route-error'

/**
 * **Home and the 404 are eager; everything else is split.**
 *
 * Statically importing all 25 route modules meant a customer landing on a
 * product page downloaded the checkout, the account section and every form
 * validator before anything rendered — one 225 kB bundle for a page that needs
 * a fraction of it.
 *
 * Home stays eager because it is the most common entry point and lazily
 * loading the first thing anyone sees only adds a round trip. `not-found` is
 * eager because it is the fallback: fetching a chunk to tell somebody a chunk
 * was not found is a bad failure mode.
 *
 * The layouts stay eager too — they render on every route, so splitting them
 * would buy nothing and cost a waterfall.
 */
const ProductPage = lazyRoute(() => import('./product'))
const CategoryPage = lazyRoute(() => import('./category'))
const CollectionPage = lazyRoute(() => import('./collection'))
const CollectionsPage = lazyRoute(() => import('./collections'))
const SearchPage = lazyRoute(() => import('./search'))
const CartPage = lazyRoute(() => import('./cart'))
const WishlistPage = lazyRoute(() => import('./wishlist'))
const CheckoutPage = lazyRoute(() => import('./checkout'))
const LoginPage = lazyRoute(() => import('./auth/login'))
const RegisterPage = lazyRoute(() => import('./auth/register'))
const ForgotPasswordPage = lazyRoute(() => import('./auth/forgot-password'))
const ResetPasswordPage = lazyRoute(() => import('./auth/reset-password'))
const VerifyEmailPage = lazyRoute(() => import('./auth/verify-email'))
const AddressesPage = lazyRoute(() => import('./account/addresses'))
const OrdersPage = lazyRoute(() => import('./account/orders'))
const OrderDetailPage = lazyRoute(() => import('./account/order-detail'))
const ProfilePage = lazyRoute(() => import('./account/profile'))

/**
 * The storefront's route tree. A path is mounted only once the screen behind it
 * is built, so a half-built screen is never reachable from a URL.
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
    /**
     * `errorElement` sits on the root so it catches every route beneath it,
     * including a layout that throws. React Router walks up to the nearest one,
     * so a per-route boundary would only be worth adding where a section can
     * usefully survive its neighbour failing — nothing here can.
     */
    errorElement: <RouteError />,
    /**
     * A single root wrapping all three route groups, so scroll behaviour is
     * mounted once rather than repeated in ShopLayout, CheckoutLayout and
     * AuthLayout — and so it also covers a jump between two of them.
     */
    element: <RootLayout />,
    children: [
      {
        element: <ShopLayout />,
        children: [
          { index: true, element: <HomePage /> },

          { path: 'products/:slug', element: <ProductPage /> },
          { path: 'categories/:slug', element: <CategoryPage /> },
          // Before ':slug', or 'collections' with no slug never matches the index.
          { path: 'collections', element: <CollectionsPage /> },
          { path: 'collections/:slug', element: <CollectionPage /> },
          { path: 'search', element: <SearchPage /> },

          // Public, both of them: filling a cart and saving things needs no account.
          // The auth wall sits on checkout, which arrives in Phase 15.
          { path: 'cart', element: <CartPage /> },
          { path: 'wishlist', element: <WishlistPage /> },

          {
            element: <RequireAuth />,
            children: [
              /**
               * The account is one place with three screens, so it gets a layout
               * and a sub-nav rather than three unrelated routes. `/account` lands
               * on the profile — the first thing in the nav, and the screen that
               * says whose account this is.
               */
              {
                path: 'account',
                element: <AccountLayout />,
                children: [
                  { index: true, element: <ProfilePage /> },
                  { path: 'orders', element: <OrdersPage /> },
                  { path: 'orders/:orderNumber', element: <OrderDetailPage /> },
                  { path: 'addresses', element: <AddressesPage /> },
                  { path: 'profile', element: <ProfilePage /> },
                ],
              },
              // Phase 15: /checkout   Phase 16: /account/orders, /account/addresses
            ],
          },

          // Last in this group: it matches anything the routes above did not.
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        /**
         * Checkout sits outside ShopLayout for the same reason the auth screens do:
         * it has its own chrome, deliberately without the nav. Still behind
         * RequireAuth, which sends a guest to /login?redirect=/checkout.
         */
        element: <CheckoutLayout />,
        children: [
          {
            element: <RequireAuth />,
            children: [{ path: 'checkout', element: <CheckoutPage /> }],
          },
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
    ],
  },
])
