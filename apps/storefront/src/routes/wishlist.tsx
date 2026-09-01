import * as React from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Heart, X } from 'lucide-react'
import { useCart, openCartDrawer } from '@/features/cart/use-cart'
import { useWishlist } from '@/features/wishlist/use-wishlist'
import { Price } from '@/components/price'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { WishlistItem } from '@/types/api'

/**
 * Saved products. Public, like the cart.
 *
 * A wishlist is per product and a cart is per variant, so moving one across
 * needs a size — and it is picked on the tile rather than by sending someone
 * back to the product page for one tap.
 */
export default function WishlistPage() {
  const { items, count, isLoading } = useWishlist()

  React.useEffect(() => {
    document.title = count > 0 ? `Saved (${count}) · StrideX` : 'Saved · StrideX'
  }, [count])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Skeleton className="h-7 w-32" />
        <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="aspect-[3/2] w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <Heart className="text-muted-foreground/40 size-9" />
        <h1 className="mt-5 text-xl">Nothing saved yet</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Tap the heart on anything you want to come back to.
        </p>
        <Button asChild variant="accent" className="mt-6">
          <Link to="/collections/new-arrivals">Shop new arrivals</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-xl sm:text-2xl">Saved ({count})</h1>

      <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <WishlistTile key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function WishlistTile({ item }: { item: WishlistItem }) {
  const { remove } = useWishlist()
  const { add } = useCart()
  const [variantId, setVariantId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const soldOut = item.stock === 'SOLD_OUT'
  const sellable = item.variants.filter((variant) => variant.stock !== 'SOLD_OUT')
  const chosen = item.variants.find((variant) => variant.id === variantId) ?? null

  const addToCart = async () => {
    if (!chosen) return
    setBusy(true)
    try {
      await add({ variantId: chosen.id, quantity: 1, priceSeen: chosen.price })
      openCartDrawer()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not add that to your cart')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group">
      <div className="bg-secondary relative aspect-[3/2] w-full overflow-hidden">
        <Link to={`/products/${item.slug}`}>
          {item.image ? (
            <img
              src={item.image.url}
              alt={item.image.altText ?? item.title}
              className={cn(
                'absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]',
                soldOut && 'opacity-50',
              )}
              loading="lazy"
            />
          ) : null}
        </Link>

        <button
          type="button"
          onClick={() => void remove(item.id)}
          aria-label={`Remove ${item.title} from wishlist`}
          className="bg-background/90 hover:bg-background absolute top-2 right-2 flex size-7 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-3.5" />
        </button>

        {soldOut && (
          <span className="bg-background/90 absolute bottom-2 left-2 px-2 py-1 text-[11px] tracking-[0.08em] uppercase">
            Sold out
          </span>
        )}
      </div>

      <div className="mt-3">
        {item.brand && (
          <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
            {item.brand.name}
          </p>
        )}
        <Link to={`/products/${item.slug}`} className="mt-1 block line-clamp-2 text-sm leading-snug">
          {item.title}
        </Link>
        <Price
          price={item.price}
          compareAtPrice={item.compareAtPrice}
          discountPercent={item.discountPercent}
          size="sm"
          className="mt-1.5"
        />

        {/*
          The size picker is here rather than on the product page because the
          whole point of this screen is deciding without leaving it. A sold-out
          size is disabled rather than hidden — a shopper should see that theirs
          is the one that went.
        */}
        {!soldOut && (
          <div className="mt-3 space-y-2">
            <select
              value={variantId ?? ''}
              onChange={(event) => setVariantId(event.target.value || null)}
              aria-label={`Choose a size for ${item.title}`}
              className="border-input h-9 w-full border bg-transparent px-2 text-sm"
            >
              <option value="">Select a size</option>
              {item.variants.map((variant) => (
                <option key={variant.id} value={variant.id} disabled={variant.stock === 'SOLD_OUT'}>
                  {variant.label}
                  {variant.stock === 'SOLD_OUT' ? ' — sold out' : ''}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant={chosen ? 'accent' : 'default'}
              className="w-full"
              disabled={!chosen || busy || sellable.length === 0}
              onClick={() => void addToCart()}
            >
              {chosen ? 'Add to cart' : 'Select a size'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
