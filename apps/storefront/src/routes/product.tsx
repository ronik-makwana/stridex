import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useProduct, useRelatedProducts } from '@/features/catalog/queries'
import { useVariantSelection } from '@/features/catalog/use-variant-selection'
import { ImageGallery } from '@/components/image-gallery'
import { OptionPicker } from '@/components/size-picker'
import { Price, PriceRange } from '@/components/price'
import { ProductCard } from '@/components/product-card'
import { ReviewsPanel } from '@/components/reviews-panel'
import { StockLabel } from '@/components/stock-label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import NotFoundPage from './not-found'

export default function ProductPage() {
  const { slug = '' } = useParams()
  const { data: product, isPending, error } = useProduct(slug)
  const { data: related } = useRelatedProducts(slug)
  const selection = useVariantSelection(product)

  // An archived or non-existent product is a 404 from the API, and the customer
  // gets the same page either way — an archived product must not confirm it
  // ever existed (§18).
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />
  if (isPending) return <ProductSkeleton />
  if (!product) return <NotFoundPage />

  const soldOut = selection.displayStock === 'SOLD_OUT'
  const needsChoice = selection.incomplete
  // Sold out on the chosen combination, as opposed to the product as a whole.
  const chosenSoldOut = selection.variant?.stock === 'SOLD_OUT'
  const canBuy = !soldOut && !needsChoice && !chosenSoldOut

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10">
      <Breadcrumbs product={product} />

      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <ImageGallery
          images={product.media}
          title={product.title}
          activeMediaId={selection.variant?.mediaId}
        />

        {/* Buy box. Sticky on desktop so the options stay reachable while the
            customer scrolls the spec table. */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {product.brand && (
            <Link
              to={`/c/${product.brand.slug}`}
              className="text-muted-foreground hover:text-foreground text-xs tracking-[0.12em] uppercase transition-colors"
            >
              {product.brand.name}
            </Link>
          )}
          <h1 className="mt-2 text-2xl leading-tight sm:text-3xl">{product.title}</h1>

          <div className="mt-4">
            {selection.variant ? (
              <Price
                price={selection.variant.price}
                compareAtPrice={selection.variant.compareAtPrice}
                discountPercent={selection.variant.discountPercent}
                size="lg"
              />
            ) : product.priceRange ? (
              <PriceRange min={product.priceRange.min} max={product.priceRange.max} />
            ) : null}
          </div>

          <StockLabel stock={selection.displayStock} className="mt-2" />

          <div className="mt-6 space-y-5">
            {selection.options.map((option) => (
              <OptionPicker key={option.id} option={option} onSelect={selection.select} />
            ))}
          </div>

          <Button
            /*
             * The accent is spent only on a CTA the customer can actually act
             * on. A disabled accent button renders as washed-out red, which
             * spends the scarce colour on a dead control and makes "Sold out"
             * look like a faded sale badge.
             */
            variant={canBuy ? 'accent' : 'default'}
            size="lg"
            className="mt-8 w-full"
            disabled={!canBuy}
            onClick={() =>
              toast('The bag arrives in Phase 14', {
                description: `${product.title} — ${selection.variant?.sku}`,
              })
            }
          >
            {soldOut || chosenSoldOut
              ? 'Sold out'
              : needsChoice
                ? `Select a ${selection.missing[0]?.name.toLowerCase() ?? 'size'}`
                : 'Add to bag'}
          </Button>

          {/* Only once a real, unavailable variant is chosen — not while the
              customer has simply not picked yet. */}
          {chosenSoldOut && (
            <p className="text-muted-foreground mt-3 text-sm">
              That combination is sold out. Try another size or colour.
            </p>
          )}

          {product.description && (
            <div className="mt-10 border-t pt-6">
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}

          {/*
            The spec table sits under the description in the buy column, not
            full-width below the gallery. Keeping it here means everything the
            customer reads about the product is in one column they scan top to
            bottom, instead of the eye jumping back left after the description.
          */}
          {product.attributes.length > 0 && (
            <div className="mt-10 border-t pt-6">
              <h2 className="text-xs tracking-[0.14em] uppercase">Specification</h2>
              <dl className="mt-4 divide-y border-y">
                {product.attributes.map((attribute) => (
                  <div key={attribute.id} className="grid grid-cols-3 gap-4 py-3">
                    <dt className="text-muted-foreground text-sm">{attribute.name}</dt>
                    <dd className="col-span-2 text-sm">{attribute.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      {related && related.length > 0 && (
        <section className="mt-20">
          <h2 className="text-center text-xs tracking-[0.14em] uppercase">You may also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}

      {/*
        Rendered at its real size against zero reviews, so Phase 17 fills it
        rather than reshaping the page around it.
      */}
      <ReviewsPanel slug={product.slug} />
    </div>
  )
}

function Breadcrumbs({ product }: { product: { breadcrumbs: { id: string; name: string; slug: string }[]; title: string } }) {
  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link to="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
        </li>
        {product.breadcrumbs.map((crumb) => (
          <li key={crumb.id} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <Link to={`/c/${crumb.slug}`} className="hover:text-foreground transition-colors">
              {crumb.name}
            </Link>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden>/</span>
          <span className="text-foreground">{product.title}</span>
        </li>
      </ol>
    </nav>
  )
}

/** Shaped like the content it replaces, so the page does not reflow on arrival. */
function ProductSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10">
      <Skeleton className="h-3 w-64" />
      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <Skeleton className="aspect-square w-full" />
          <div className="mt-3 flex gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="size-20" />
            ))}
          </div>
        </div>
        <div>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-8 w-3/4" />
          <Skeleton className="mt-5 h-7 w-32" />
          <Skeleton className="mt-3 h-4 w-24" />
          <Skeleton className="mt-9 h-4 w-16" />
          <div className="mt-3 flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-14" />
            ))}
          </div>
          <Skeleton className="mt-8 h-12 w-full" />
        </div>
      </div>
    </div>
  )
}
