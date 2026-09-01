import { Link } from 'react-router'
import { useCollections } from '@/features/catalog/queries'
import { Skeleton } from '@/components/ui/skeleton'

/** A plain tile index. Empty collections never reach here — the API drops them. */
export default function CollectionsPage() {
  const { data: collections, isPending } = useCollections()

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10">
      <h1 className="text-2xl sm:text-3xl">Collections</h1>

      {isPending ? (
        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="aspect-[3/2] w-full" />
              <Skeleton className="mt-3 h-5 w-40" />
            </div>
          ))}
        </div>
      ) : (collections?.length ?? 0) === 0 ? (
        <p className="text-muted-foreground mt-10 text-sm">
          No collections are published yet.
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {collections!.map((collection) => (
            <Link key={collection.id} to={`/collections/${collection.slug}`} className="group block">
              <div className="bg-secondary relative aspect-[3/2] w-full overflow-hidden">
                {collection.imageUrl && (
                  <img
                    src={collection.imageUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                )}
              </div>
              <h2 className="mt-3 text-base font-normal">{collection.name}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {collection.productCount} {collection.productCount === 1 ? 'product' : 'products'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
