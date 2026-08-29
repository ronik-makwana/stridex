import * as React from 'react'
import { Link } from 'react-router'
import { History, SearchX, Warehouse } from 'lucide-react'
import { useListParams } from '@/hooks/use-list-params'
import { useInventory } from '@/features/inventory/queries'
import { useBrands } from '@/features/brands/queries'
import type { InventoryRow } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Button } from '@/components/ui/button'
import { AdjustStockDialog, type StockTarget } from './adjust-stock-dialog'
import { RestockDialog } from './restock-dialog'
import { InventoryTable, toTarget } from './inventory-table'

type Filter = 'brandId' | 'stock'

const STOCK_OPTIONS = [
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
]

export default function InventoryPage() {
  const params = useListParams<Filter>({
    defaultSort: 'available:asc',
    filters: ['brandId', 'stock'],
  })

  const { data, isPending, isFetching, error } = useInventory(params.toQuery())
  const { data: brands } = useBrands({ limit: 100, sort: 'name:asc' })

  const [adjusting, setAdjusting] = React.useState<StockTarget | null>(null)
  const [restocking, setRestocking] = React.useState<StockTarget | null>(null)

  const openAdjust = React.useCallback((row: InventoryRow) => setAdjusting(toTarget(row)), [])
  const openRestock = React.useCallback((row: InventoryRow) => setRestocking(toTarget(row)), [])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Every sellable SKU. Available is what is left after pending orders have taken their share."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/inventory/low-stock">Low stock</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/inventory/transactions">
                <History className="size-4" />
                Ledger
              </Link>
            </Button>
          </>
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search SKU or product"
        showClear={params.isFiltered}
        onClear={params.clear}
      >
        <FilterSelect
          label="Brand"
          value={params.filters.brandId}
          onChange={(value) => params.setFilter('brandId', value)}
          options={(brands?.data ?? []).map((brand) => ({ value: brand.id, label: brand.name }))}
        />
        <FilterSelect
          label="Stock"
          value={params.filters.stock}
          onChange={(value) => params.setFilter('stock', value)}
          options={STOCK_OPTIONS}
        />
      </FilterBar>

      <InventoryTable
        rows={data?.data ?? []}
        isLoading={isPending}
        error={error}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        onAdjust={openAdjust}
        onRestock={openRestock}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No stock matches those filters"
              description="Try a different search, or clear the filters to see everything."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Warehouse}
              title="No stock to show yet"
              description="Stock appears here as soon as a product has variants. Generate some from a product first."
              action={
                <Button size="sm" asChild>
                  <Link to="/products">Go to products</Link>
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      <AdjustStockDialog target={adjusting} onOpenChange={(open) => !open && setAdjusting(null)} />
      <RestockDialog target={restocking} onOpenChange={(open) => !open && setRestocking(null)} />
    </div>
  )
}
