import * as React from 'react'
import { Outlet, useLocation } from 'react-router'
import { toast } from 'sonner'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { CartDrawer } from '@/components/cart-drawer'
import { useAuth } from '@/lib/auth'

/**
 * Every public page. The header and footer are constant; only the outlet
 * changes, so a category → product → cart journey never remounts the shell.
 */
export function ShopLayout() {
  const { sessionExpired, dismissSessionExpired } = useAuth()
  const location = useLocation()

  /*
   * A toast, not the modal the admin app uses. Nothing on a storefront is lost
   * when a session lapses — the customer keeps browsing, and their cart lives in
   * localStorage until they sign back in. Interrupting a browse with a dialog
   * would cost more than it explains. Checkout is the exception, and it is
   * behind RequireAuth, which redirects rather than toasts.
   */
  React.useEffect(() => {
    if (!sessionExpired) return
    toast('You have been signed out', {
      description: 'Sign in again to see your orders.',
      action: {
        label: 'Sign in',
        // Read at click time so it carries wherever the customer has since
        // navigated, not wherever they were when the session lapsed.
        onClick: () => {
          window.location.assign(`/login?redirect=${encodeURIComponent(location.pathname)}`)
        },
      },
    })
    dismissSessionExpired()
  }, [sessionExpired, dismissSessionExpired, location.pathname])

  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      {/* `flex-1` so a short page still pins the footer to the bottom. */}
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />

      {/* Mounted once, opened from anywhere: adding from a product page and
          adding from a wishlist tile are the same drawer. */}
      <CartDrawer />
    </div>
  )
}
