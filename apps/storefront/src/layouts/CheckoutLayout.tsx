import { Link, Outlet } from 'react-router'
import { Lock } from 'lucide-react'

/**
 * Checkout gets its own chrome, and the point of it is what is missing.
 *
 * No nav, no search, no wishlist, no cart icon: every one of those is a way to
 * leave a page the customer came here to finish, and one of them — the cart —
 * would send them back to edit a cart whose stock this page is already holding.
 * The same reasoning as `AuthLayout`, for the same reason.
 *
 * The wordmark still links home. Someone who arrived here by accident needs one
 * way out that is not the back button, and the checkout survives them leaving:
 * the session expires on its own and hands the stock back.
 */
export function CheckoutLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="wordmark wordmark-boxed text-base" aria-label="StrideX home">
            StrideX
          </Link>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Lock className="size-3.5" />
            Secure checkout
          </p>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* One line, not the four-column footer. A link farm under a payment
          button is a set of exits at the moment they cost the most. */}
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs sm:px-6">
          <span>© {new Date().getFullYear()} StrideX</span>
          <span>VISA · MASTERCARD · UPI · CASH ON DELIVERY</span>
        </div>
      </footer>
    </div>
  )
}
