import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Clock, Heart, ShoppingBag } from 'lucide-react'
import { useCart } from '@/features/cart/use-cart'
import { CHECKOUT_PATH, canCheckout } from '@/features/cart/checkout'
import { useActiveCheckout, useCountdown } from '@/features/checkout/use-checkout'
import { useWishlist } from '@/features/wishlist/use-wishlist'
import { CartLineRow } from '@/components/cart-line-row'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api-client'
import { formatMoney } from '@/lib/format'

/**
 * The cart, as a real page rather than only a drawer — it is linkable, the back
 * button behaves, and it is where the stale-cart states have room to be read.
 *
 * Public: filling a cart needs no account, and the auth wall sits on checkout.
 */
export default function CartPage() {
  const { cart, items, itemCount, subtotal, hasIssues, isLoading, isMutating, update, remove } = useCart()
  const wishlist = useWishlist()
  const [movingAll, setMovingAll] = React.useState(false)

  usePageMeta({ title: itemCount > 0 ? `Cart (${itemCount})` : 'Cart' })

  const act = async (run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (error) {
      // A 422 here is the designed answer, not a failure: stock moved under an
      // open tab. The message names what happened.
      toast.error(error instanceof ApiError ? error.message : 'Could not update your cart')
    }
  }

  /**
   * Saves every line's product, then empties the cart — in that order, so a
   * failure leaves the cart intact rather than losing both.
   */
  const moveAllToWishlist = async () => {
    setMovingAll(true)
    try {
      const productIds = [...new Set(items.map((line) => line.productId).filter(Boolean))]
      for (const productId of productIds) await wishlist.save(productId as string)
      for (const line of items) await remove(line)
      toast.success(productIds.length === 1 ? 'Moved to wishlist' : `${productIds.length} moved to wishlist`)
    } catch {
      toast.error('Could not move everything — your cart is unchanged')
    } finally {
      setMovingAll(false)
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Skeleton className="h-7 w-32" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-32 w-full" />
            ))}
          </div>
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <ShoppingBag className="text-muted-foreground/40 size-9" />
        <h1 className="mt-5 text-xl">Your cart is empty</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Nothing in here yet. The new arrivals are a reasonable place to start.
        </p>
        <div className="mt-6 flex gap-3">
          <Button asChild variant="accent">
            <Link to="/collections/new-arrivals">Shop new arrivals</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/collections">All collections</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl sm:text-2xl">Cart ({itemCount})</h1>
        <Link to="/collections" className="text-sm underline underline-offset-4">
          Continue shopping
        </Link>
      </div>

      <ResumeCheckout />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="divide-y border-t">
          {items.map((line) => (
            <CartLineRow
              key={line.id ?? line.variantId}
              line={line}
              busy={isMutating || movingAll}
              onQuantityChange={(quantity) => void act(() => update({ line, quantity }))}
              onRemove={() => void act(() => remove(line))}
            />
          ))}
        </div>

        <aside className="h-fit border p-5 lg:sticky lg:top-24">
          <h2 className="text-xs tracking-[0.14em] uppercase">Summary</h2>

          <div className="mt-5 flex items-baseline justify-between">
            <span className="text-sm">Subtotal</span>
            <span className="tabular-nums">{formatMoney(subtotal)}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">Shipping calculated at checkout.</p>

          {hasIssues && (
            <p className="mt-4 text-xs text-amber-700 dark:text-amber-500">
              Some lines changed since you added them. Check them above before you continue.
            </p>
          )}

          {/*
            Checkout arrives in Phase 15 — and it, not this button, is where the
            auth wall sits. Disabled while every line is unbuyable, because a
            checkout with nothing to sell is a dead end with a redirect.
          */}
          <CheckoutButton disabled={!canCheckout(cart)} />

          <button
            type="button"
            onClick={() => void moveAllToWishlist()}
            disabled={movingAll || isMutating}
            className="text-muted-foreground hover:text-foreground mt-4 flex w-full items-center justify-center gap-2 text-sm transition-colors disabled:opacity-40"
          >
            <Heart className="size-4" />
            Move all to wishlist
          </button>
        </aside>
      </div>
    </div>
  )
}

/**
 * The bridge back to a checkout somebody walked away from.
 *
 * Without it a session is only reachable by an id the cart never had: pressing
 * Back left the customer with no way to return to it, and — worse — no way to
 * know that their size was being held at all. Starting a fresh checkout works,
 * but it re-reads prices and restarts the clock, and neither is what somebody
 * who stepped away for thirty seconds wanted.
 */
function ResumeCheckout() {
  const { session, cancel, isCancelling } = useActiveCheckout()
  const countdown = useCountdown(session?.expiresAt)

  // A payment already in flight is not something to resume or cancel — the
  // checkout page itself is watching for the provider's answer.
  if (!session || session.status !== 'ACTIVE' || countdown.expired) return null

  const cancelCheckout = async () => {
    try {
      await cancel(session.id)
      toast.success('Checkout cancelled — the items are back on the shelf')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel that checkout')
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border px-4 py-3">
      <p className="flex items-center gap-2 text-sm">
        <Clock className="size-4 shrink-0" />
        <span>
          You have a checkout in progress — these items are held for{' '}
          <span className="tabular-nums">{countdown.text}</span>.
        </span>
      </p>
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="accent">
          {/* Straight back to the session that exists, not a new one. */}
          <Link to={`${CHECKOUT_PATH}?s=${session.id}`}>Resume checkout</Link>
        </Button>
        <button
          type="button"
          onClick={() => void cancelCheckout()}
          disabled={isCancelling}
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 disabled:opacity-40"
        >
          Cancel and free the items
        </button>
      </div>
    </div>
  )
}

/**
 * Disabled while a checkout is already open, and it stays a *button* rather
 * than becoming a link to the live session.
 *
 * Two reasons. The API refuses a second checkout, so an enabled button here
 * would be an invitation to an error. And there is exactly one place to act on
 * the session that exists — the banner at the top of this page, which offers
 * both things worth doing — so a second, competing control beside the subtotal
 * would just be a third way to ask the same question.
 *
 * `asChild` with `disabled` only styles the link; a real button is the only
 * thing that actually cannot be clicked through.
 */
function CheckoutButton({ disabled }: { disabled: boolean }) {
  const { session } = useActiveCheckout()
  const live = session?.status === 'ACTIVE' ? session : null

  if (live) {
    return (
      <>
        <Button variant="accent" size="lg" className="mt-5 w-full" disabled>
          Checkout
        </Button>
        <p className="text-muted-foreground mt-2 text-xs">
          A checkout is already in progress. Resume or cancel it above to start a new one.
        </p>
      </>
    )
  }

  return (
    <Button asChild variant="accent" size="lg" className="mt-5 w-full" disabled={disabled}>
      <Link to={CHECKOUT_PATH}>Checkout</Link>
    </Button>
  )
}
