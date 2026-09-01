import { Link } from 'react-router'
import { ShoppingBag } from 'lucide-react'
import { useCart, useCartDrawer } from '@/features/cart/use-cart'
import { CHECKOUT_PATH, canCheckout } from '@/features/cart/checkout'
import { CartLineRow } from '@/components/cart-line-row'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { formatMoney } from '@/lib/format'

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
            <Button asChild size="lg" variant="accent" className="w-full" disabled={!canCheckout(cart)}>
              {/* Closed on the way out: leaving a drawer open over the page it
                  just sent you to is how a back button gets pressed by mistake. */}
              <Link to={CHECKOUT_PATH} onClick={closeDrawer}>
                Checkout
              </Link>
            </Button>
          </footer>
        )}
      </SheetContent>
    </Sheet>
  )
}
