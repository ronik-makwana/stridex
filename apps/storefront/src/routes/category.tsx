import { Link, useParams } from 'react-router'
import { ApiError } from '@/lib/api-client'
import { useCategory } from '@/features/catalog/queries'
import { ProductBrowser } from '@/components/product-browser'
import { Skeleton } from '@/components/ui/skeleton'
import NotFoundPage from './not-found'

/** `/categories/:slug`. The grid comes from `GET /products?category=`, not from here. */
export default function CategoryPage() {
  const { slug = '' } = useParams()
  const { data: category, isPending, error } = useCategory(slug)

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />

  return (
    <ProductBrowser
      // Remounts on slug change so filters do not leak from one category to
      // the next — the URL is cleared by navigation, and this keeps the
      // component's own state in step with it.
      key={slug}
      scope={{ category: slug }}
      emptyMessage="Nothing in this category matches those filters."
      header={
        isPending ? (
          <div>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="mt-4 h-8 w-64" />
          </div>
        ) : category ? (
          <div>
            <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
              <ol className="flex flex-wrap items-center gap-1.5">
                <li>
                  <Link to="/" className="hover:text-foreground transition-colors">
                    Home
                  </Link>
                </li>
                {category.breadcrumbs.map((crumb, index) => (
                  <li key={crumb.id} className="flex items-center gap-1.5">
                    <span aria-hidden>/</span>
                    {index === category.breadcrumbs.length - 1 ? (
                      <span className="text-foreground">{crumb.name}</span>
                    ) : (
                      <Link to={`/categories/${crumb.slug}`} className="hover:text-foreground transition-colors">
                        {crumb.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <h1 className="mt-4 text-2xl sm:text-3xl">{category.name}</h1>
            {category.description && (
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm">{category.description}</p>
            )}
          </div>
        ) : null
      }
    />
  )
}
