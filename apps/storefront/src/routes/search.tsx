import { useSearchParams } from 'react-router'
import { ProductBrowser } from '@/components/product-browser'

/**
 * `/search?q=`. No dedicated search endpoint: results are the product grid with
 * a `q` filter, so search gets the same facets and the same sort as everything
 * else, for free and without a second query to keep in step.
 */
export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q')?.trim() ?? ''

  if (!q) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl">Search</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Type in the box above to find a product.
        </p>
      </div>
    )
  }

  return (
    <ProductBrowser
      key={q}
      emptyMessage={`Nothing matches “${q}”.`}
      header={
        <div>
          <p className="text-muted-foreground text-xs tracking-[0.14em] uppercase">Search</p>
          <h1 className="mt-3 text-2xl sm:text-3xl">“{q}”</h1>
        </div>
      }
    />
  )
}
