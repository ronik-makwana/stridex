import { Link, Outlet } from 'react-router'

/**
 * Centred card, ~400px, wordmark above, nothing else on the page. No header,
 * no nav, no footer: this is the one place in the storefront where the only
 * reasonable next action is to finish the form, and every link out of it is a
 * way to not finish it.
 *
 * The wordmark still links home, because a customer who arrived here by
 * accident needs one way out that is not the back button.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="wordmark text-lg" aria-label="StrideX home">
        StrideX
      </Link>
      <div className="mt-8 w-full max-w-[400px]">
        <Outlet />
      </div>
    </div>
  )
}
