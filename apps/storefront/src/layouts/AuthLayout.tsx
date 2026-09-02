import { Link, Outlet } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Centred card, ~400px, wordmark above, nothing else on the page. No header,
 * no nav, no footer: this is the one place in the storefront where the only
 * reasonable next action is to finish the form, and every link out of it is a
 * way to not finish it.
 *
 * The ground is tinted so the card reads as one. On the white page background
 * the rest of the storefront uses, a white card is only its own border — a box
 * drawn around a form rather than a surface holding it. `bg-muted` is the one
 * token to change if this wants to be fainter, or white again.
 *
 * The wordmark still links home, because a customer who arrived here by
 * accident needs one way out that is not the back button.
 */
export function AuthLayout() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="wordmark wordmark-boxed text-base" aria-label="StrideX home">
        StrideX
      </Link>
      <Card className="mt-8 w-full max-w-[400px]">
        <CardContent>
          <Outlet />
        </CardContent>
      </Card>
    </div>
  )
}
