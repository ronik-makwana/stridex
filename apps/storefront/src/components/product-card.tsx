import { Link } from 'react-router'
import { Price } from '@/components/price'
import { Stars } from '@/components/star-rating'
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
          Always rendered, including at zero, so every card in a row is the same
          height and the grid never goes ragged. An unreviewed product shows
          five empty stars and `0.0 | 0`.
        */}
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
            {product.rating.count === 0
              ? 'No reviews yet'
              : `${product.rating.average.toFixed(1)} out of 5 from ${product.rating.count} ${
                  product.rating.count === 1 ? 'review' : 'reviews'
                }`}
          </span>
        </p>

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
