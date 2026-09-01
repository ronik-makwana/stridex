import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useFacets, useProducts } from '@/features/catalog/queries'
import { toApiParams, useListParams } from '@/features/catalog/use-list-params'
import { FilterSidebar } from '@/components/filter-sidebar'
import { Pagination } from '@/components/pagination'
import { ProductGrid, ProductGridSkeleton } from '@/components/product-grid'
import { SortSelect } from '@/components/sort-select'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

/**
 * Grid + sidebar + sort + pagination, driven entirely by the URL.
 *
 * Category, collection and search all render through this one component. That
 * is the front-end half of the same decision the API made with a single
 * where-clause: build them separately and the three quietly stop agreeing about
 * what a filter means.
 *
 * `scope` is whatever pins this view — `{ category: 'men' }` or
 * `{ collection: 'summer-sale' }`. Everything else comes from the query string.
 */
export function ProductBrowser({
  scope = {},
  header,
  emptyMessage = 'Nothing matches those filters.',
}: {
  scope?: Record<string, string>
  header?: React.ReactNode
  emptyMessage?: string
}) {
  const { params, update, toggleValue, setPage, clearAll, activeCount } = useListParams()
  const apiParams = toApiParams(params, scope)

  const { data, isPending, isFetching } = useProducts(apiParams)
  const { data: facets, isPending: facetsPending } = useFacets(apiParams)

  const onPriceChange = (min?: number, max?: number) =>
    update({
      minPrice: min !== undefined ? String(min) : null,
      maxPrice: max !== undefined ? String(max) : null,
    })

  const filters = (
    <FilterSidebar
      facets={facets}
      params={params}
      onToggle={toggleValue}
      onPriceChange={onPriceChange}
      onClear={clearAll}
      activeCount={activeCount}
      isPending={facetsPending}
    />
  )

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
      {header}

      <div className="mt-8 lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-24">{filters}</div>
        </aside>

        <div>
          {/*
            The toolbar and its rule live in the grid column, not across the
            whole page. The count and the sort describe the grid, so the line
            under them should measure the grid — a divider running the full
            1400px reads as a page header and visually detaches the sidebar
            from the results it filters.
          */}
          <div className="mb-8 flex items-center justify-between gap-4 border-b pb-4">
            <p className="text-muted-foreground text-sm tabular-nums">
              {isPending
                ? 'Loading…'
                : `${data?.meta.total ?? 0} ${data?.meta.total === 1 ? 'product' : 'products'}`}
            </p>

            <div className="flex items-center gap-3">
              {/* The sidebar becomes a drawer below lg, where there is no room
                  for a persistent column beside a two-up grid. */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="lg:hidden">
                    <SlidersHorizontal />
                    Filters{activeCount > 0 ? ` (${activeCount})` : ''}
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" title="Filters" className="overflow-y-auto p-6">
                  <h2 className="mb-6 text-sm font-medium">Filters</h2>
                  {filters}
                </SheetContent>
              </Sheet>

              <SortSelect value={params.sort} onChange={(sort) => update({ sort })} />
            </div>
          </div>

          {isPending ? (
            <ProductGridSkeleton />
          ) : (data?.data.length ?? 0) === 0 ? (
            <div className="py-24 text-center">
              <p className="text-sm">{emptyMessage}</p>
              {activeCount > 0 && (
                <Button variant="outline" className="mt-4" onClick={clearAll}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <ProductGrid products={data!.data} isFetching={isFetching} />
              <Pagination
                page={data!.meta.page}
                totalPages={data!.meta.totalPages}
                onChange={setPage}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
