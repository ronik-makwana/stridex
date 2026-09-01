import { Link } from 'react-router'
import { toast } from 'sonner'
import { ShoppingBag } from 'lucide-react'
import { useCart, useCartDrawer } from '@/features/cart/use-cart'
import { CHECKOUT_PATH, canCheckout } from '@/features/cart/checkout'
import { useActiveCheckout, useCountdown } from '@/features/checkout/use-checkout'
import { CartLineRow } from '@/components/cart-line-row'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { ApiError } from '@/lib/api-client'
import { formatMoney } from '@/lib/format'
import type { Cart } from '@/types/api'

/**
 * The same lines as `/cart`, in a right slide-over, opened by Add to cart from
 * anywhere. Mounted once in the layout rather than per page, so adding from a
 * product page and adding from a wishlist tile open the same drawer.
 *
 * `/cart` remains a real route. The drawer is the fast path, not the only one —
 * a cart you cannot link to or reach with the back button is a cart people lose.
 */
export function CartDrawer() {
  const { open, setOpen, closeDrawer } = useCartDrawer()
  const { cart, items, itemCount, subtotal, isLoading, isMutating, update, remove } = useCart()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        title="Your cart"
        description="The items you have added, and what they cost."
        className="sm:max-w-md"
      >
        {/* `pr-12` clears the sheet's own close button, which is positioned
            top-right over this row. */}
        <header className="flex items-baseline justify-between border-b py-4 pr-12 pl-5">
          <h2 className="text-sm tracking-[0.14em] uppercase">
            Cart{itemCount > 0 && ` (${itemCount})`}
          </h2>
          <Link to="/cart" onClick={closeDrawer} className="text-xs underline underline-offset-4">
            View cart
          </Link>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
              <Spinner />
              Loading your cart
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ShoppingBag className="text-muted-foreground/40 size-8" />
              <p className="mt-4 text-sm">Your cart is empty</p>
              <Button asChild variant="outline" size="sm" className="mt-5" onClick={closeDrawer}>
                <Link to="/collections">Continue shopping</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((line) => (
                <CartLineRow
                  key={line.id ?? line.variantId}
                  line={line}
                  compact
                  busy={isMutating}
                  onNavigate={closeDrawer}
                  onQuantityChange={(quantity) => void update({ line, quantity })}
                  onRemove={() => void remove(line)}
                />
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <footer className="space-y-3 border-t px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">Subtotal</span>
              <span className="tabular-nums">{formatMoney(subtotal)}</span>
            </div>
            {/* Subtotal only. Quoting a total the checkout then contradicts is
                worse than not quoting one (§21). */}
            <p className="text-muted-foreground text-xs">Shipping calculated at checkout.</p>
            {/*
              Two ways out, in the order they are wanted: most people want to
              look at the cart, and the ones who are done want to pay without
              a stop on the way. Checkout is the accent, because it is the one
              thing on this panel worth spending it on.
            */}
            <Button asChild size="lg" variant="outline" className="w-full">
              <Link to="/cart" onClick={closeDrawer}>
                View cart
              </Link>
            </Button>
            {/* Closed on the way out: leaving a drawer open over the page it
                just sent you to is how a back button gets pressed by mistake. */}
            <DrawerCheckoutButton cart={cart} onNavigate={closeDrawer} />
          </footer>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Checkout — and, while one is already open, the two ways out of it.
 *
 * The button goes flat rather than turning into a link to the live session: the
 * API refuses a second checkout, so an enabled Checkout here would be an
 * invitation to an error, and the hint below it is where both real choices are.
 * Same treatment as the cart page's summary, so the two never disagree about
 * what a live session means.
 *
 * Cancel acts in place instead of sending anyone to /cart for it. It is the one
 * irreversible control on this panel, which is why it is a text link under a
 * dead button and not a second full-width one.
 *
 * Mounted inside the sheet rather than beside `useCart`, so `useActiveCheckout`
 * fires when the drawer opens instead of on every page an authenticated
 * customer loads.
 */
function DrawerCheckoutButton({ cart, onNavigate }: { cart: Cart; onNavigate: () => void }) {
  const { session, cancel, isCancelling } = useActiveCheckout()
  const live = session?.status === 'ACTIVE' ? session : null
  // Not to show a clock, but to keep a session whose hold has run out from
  // being offered back as if it were still good.
  const countdown = useCountdown(live?.expiresAt)

  const cancelCheckout = async () => {
    if (!live) return
    try {
      await cancel(live.id)
      toast.success('Checkout cancelled — the items are back on the shelf')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel that checkout')
    }
  }

  if (live && !countdown.expired) {
    return (
      <>
        <Button size="lg" variant="accent" className="w-full" disabled>
          Checkout
        </Button>
        {/* Two lines, centred under the dead button: the state on top, the two
            ways out of it below, so the links read as the thing to act on
            rather than as words buried in a sentence. */}
        <div className="text-muted-foreground space-y-1 text-center text-xs">
          <p>Looks like you already have a checkout in progress</p>
          <p>
            <Link
              to={`${CHECKOUT_PATH}?s=${live.id}`}
              onClick={onNavigate}
              className="text-foreground underline underline-offset-4"
            >
              resume it
            </Link>{' '}
            or{' '}
            <button
              type="button"
              onClick={() => void cancelCheckout()}
              disabled={isCancelling}
              className="text-foreground underline underline-offset-4 disabled:opacity-40"
            >
              cancel it
            </button>
          </p>
        </div>
      </>
    )
  }

  // `asChild` with `disabled` only styles the link, so a cart with nothing
  // sellable needs a real button to actually stop the click.
  if (!canCheckout(cart)) {
    return (
      <Button size="lg" variant="accent" className="w-full" disabled>
        Checkout
      </Button>
    )
  }

  return (
    <Button asChild size="lg" variant="accent" className="w-full">
      <Link to={CHECKOUT_PATH} onClick={onNavigate}>
        Checkout
      </Link>
    </Button>
  )
}
