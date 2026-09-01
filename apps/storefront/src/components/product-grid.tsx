import { ProductCard } from '@/components/product-card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ProductCard as ProductCardData } from '@/types/api'

/**
 * The one grid. Category, collection and search all render through here — if a
 * second grid ever appears, the two will drift in exactly the way the API's
 * single where-clause was built to prevent.
 */
export function ProductGrid({
  products,
  /** True while a filter change is in flight and the old page is still shown. */
  isFetching,
}: {
  products: ProductCardData[]
  isFetching?: boolean
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-10 transition-opacity sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4',
        // Dimmed, not replaced. Swapping a loaded grid for skeletons on every
        // tick throws the customer's scroll position away and flickers.
        isFetching && 'pointer-events-none opacity-50',
      )}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}

/** Shaped like the grid it replaces, so nothing reflows when the data lands. */
export function ProductGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/2] w-full" />
          <Skeleton className="mt-3 h-3 w-16" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
