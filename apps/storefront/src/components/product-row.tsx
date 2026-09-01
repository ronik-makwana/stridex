import { Link } from 'react-router'
import { ProductCard } from '@/components/product-card'
import type { ProductCard as ProductCardData } from '@/types/api'

/**
 * A labelled band of products with a way through to the full list.
 *
 * It is a grid rather than a carousel: a carousel needs a scroll container, two
 * arrow buttons, snap points and a keyboard story, and it hides half its
 * contents behind a gesture. Four cards that are simply *there* is the same
 * information with none of that, and it reuses the card the whole shop already
 * uses (§18 — nothing new invented for the home page).
 */
export function ProductRow({
  title,
  products,
  to,
  linkLabel = 'View all',
}: {
  title: string
  products: ProductCardData[]
  to: string
  linkLabel?: string
}) {
  if (products.length === 0) return null

  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs tracking-[0.14em] uppercase">{title}</h2>
        <Link to={to} className="text-sm underline underline-offset-4">
          {linkLabel}
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
        {/* Four across on desktop, two on a phone: the same rhythm as the
            category grid, so the home page reads as the same shop. */}
        {products.slice(0, 4).map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}
