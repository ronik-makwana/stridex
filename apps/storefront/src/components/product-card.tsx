import { Link } from 'react-router'
import { Price } from '@/components/price'
import { Stars } from '@/components/star-rating'
import { WishlistButton } from '@/components/wishlist-button'
import type { ProductCard as ProductCardData } from '@/types/api'

/**
 * One card. Built here in Phase 12 for "You may also like" and reused unchanged
 * by Phase 13's category grid, search results and collection pages — which is
 * why it takes the small `ProductCard` payload rather than a full product.
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link to={`/products/${product.slug}`} className="group block">
      {/*
        Every card image is the same height, whatever the source ratio: the
        frame sets the box and the image is positioned into it. Without this,
        Tailwind's `img { height: auto }` lets a landscape photo render short
        and a row of cards ends up ragged.
      */}
      <div className="bg-secondary relative aspect-[3/2] w-full overflow-hidden">
        {product.image ? (
          <img
            src={product.image.url}
            alt={product.image.altText ?? product.title}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
            No image
          </div>
        )}

        {/*
          Inside the card's <Link>, which is why the button stops the click
          itself. Always visible rather than hover-only: on a touch screen
          there is no hover, and a control that only exists on a mouse is a
          control half the customers never find.
        */}
        <WishlistButton
          productId={product.id}
          title={product.title}
          size="sm"
          className="bg-background/85 hover:bg-background absolute top-2 right-2"
        />
      </div>

      <div className="mt-3">
        {product.brand && (
          <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
            {product.brand.name}
          </p>
        )}
        {/* Two lines then ellipsis, so a long title cannot shove one card in a
            grid taller than its neighbours. */}
        <h3 className="mt-1 line-clamp-2 text-sm leading-snug font-normal">{product.title}</h3>

        {/*
          Only shown once a product actually has a review — five empty stars
          next to `0.0 | 0` reads as a bad score rather than as no score. The
          row is dropped entirely when there are none, so an unreviewed card
          closes the gap rather than leaving a hole where the stars would be.
        */}
        {product.rating.count > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5">
            <Stars value={product.rating.average} size={12} />
            <span className="text-muted-foreground text-xs tabular-nums">
              {product.rating.average.toFixed(1)}
            </span>
            <span className="text-muted-foreground/50 text-xs" aria-hidden>
              |
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {product.rating.count}
            </span>
            <span className="sr-only">
              {`${product.rating.average.toFixed(1)} out of 5 from ${product.rating.count} ${
                product.rating.count === 1 ? 'review' : 'reviews'
              }`}
            </span>
          </p>
        )}

        <Price
          price={product.price}
          compareAtPrice={product.compareAtPrice}
          discountPercent={product.discountPercent}
          size="sm"
          className="mt-1.5"
        />
      </div>
    </Link>
  )
}
