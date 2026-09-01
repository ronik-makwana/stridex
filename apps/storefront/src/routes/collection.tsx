import { useParams } from 'react-router'
import { ApiError } from '@/lib/api-client'
import { useCollection } from '@/features/catalog/queries'
import { ProductBrowser } from '@/components/product-browser'
import { Skeleton } from '@/components/ui/skeleton'
import NotFoundPage from './not-found'

/**
 * `/collections/:slug`. The same grid, the same sidebar, the same sort and the
 * same pagination as a category page — the only new part is the banner. That is
 * the whole reason collections are built in this phase rather than a later one.
 */
export default function CollectionPage() {
  const { slug = '' } = useParams()
  const { data: collection, isPending, error } = useCollection(slug)

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />

  return (
    <ProductBrowser
      key={slug}
      scope={{ collection: slug }}
      emptyMessage="Nothing in this collection matches those filters."
      header={
        isPending ? (
          <Skeleton className="aspect-[3/1] w-full" />
        ) : collection ? (
          <div>
            {collection.imageUrl && (
              <div className="bg-secondary relative mb-8 aspect-[3/1] w-full overflow-hidden">
                <img
                  src={collection.imageUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            )}
            <p className="text-muted-foreground text-xs tracking-[0.14em] uppercase">Collection</p>
            <h1 className="mt-3 text-2xl sm:text-3xl">{collection.name}</h1>
            {collection.description && (
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
                {collection.description}
              </p>
            )}
          </div>
        ) : null
      }
    />
  )
}
