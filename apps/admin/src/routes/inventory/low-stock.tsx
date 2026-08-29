import * as React from 'react'
import { PackageCheck, SearchX } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useListParams } from '@/hooks/use-list-params'
import { useLowStock } from '@/features/inventory/queries'
import { useBrands } from '@/features/brands/queries'
import type { InventoryRow } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdjustStockDialog, type StockTarget } from './adjust-stock-dialog'
import { RestockDialog } from './restock-dialog'
import { InventoryTable, toTarget } from './inventory-table'

/**
 * Per admin, not per URL. The threshold is how cautious *this buyer* is, and
 * they answer the same question every morning — asking them to re-enter it, or
 * to keep a bookmark, is asking them to do the tool's remembering.
 */
const THRESHOLD_KEY = 'admin:low-stock-threshold'

function useStoredThreshold() {
  const [value, setValue] = React.useState(() => {
    try {
      return localStorage.getItem(THRESHOLD_KEY) ?? ''
    } catch {
      // Private windows and blocked site data both throw here. An empty
      // threshold falls back to each variant's own, which is a fine default.
      return ''
    }
  })

  React.useEffect(() => {
    try {
      if (value.trim()) localStorage.setItem(THRESHOLD_KEY, value.trim())
      else localStorage.removeItem(THRESHOLD_KEY)
    } catch {
      /* nothing to do — the control still works for this session */
    }
  }, [value])

  return [value, setValue] as const
}

export default function LowStockPage() {
  const params = useListParams<'brandId'>({
    defaultSort: 'available:asc',
    filters: ['brandId'],
  })

  const [threshold, setThreshold] = useStoredThreshold()
  // Debounced, or every digit typed into the threshold box is a request.
  const debouncedThreshold = useDebouncedValue(threshold, 400)

  const parsedThreshold = Number(debouncedThreshold)
  const query = {
    ...params.toQuery(),
    ...(debouncedThreshold.trim() && Number.isInteger(parsedThreshold) && parsedThreshold >= 0
      ? { threshold: parsedThreshold }
      : {}),
  }

  const { data, isPending, isFetching, error } = useLowStock(query)
  const { data: brands } = useBrands({ limit: 100, sort: 'name:asc' })

  const [adjusting, setAdjusting] = React.useState<StockTarget | null>(null)
  const [restocking, setRestocking] = React.useState<StockTarget | null>(null)

  const openAdjust = React.useCallback((row: InventoryRow) => setAdjusting(toTarget(row)), [])
  const openRestock = React.useCallback((row: InventoryRow) => setRestocking(toTarget(row)), [])

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/inventory"
        backLabel="Back to inventory"
        title="Low stock"
        description="Anything still sellable but at or below its threshold. Sold-out SKUs are in the main list under Out of stock."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="threshold" className="text-muted-foreground text-sm">
              Threshold
            </Label>
            <Input
              id="threshold"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              inputMode="numeric"
              placeholder="Per SKU"
              className="h-8 w-24 tabular-nums"
            />
          </div>
        }
      />

      <p className="text-muted-foreground text-xs">
        {threshold.trim()
          ? `Judging every SKU against ${threshold.trim()}, ignoring its own setting.`
          : 'Judging each SKU against its own low-stock threshold. Enter a number to override them all.'}
      </p>

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
              title="Nothing low matches those filters"
              description="Try a different search, or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={PackageCheck}
              title="Nothing is running low"
              description="Every sellable SKU is above its threshold. Raise the threshold to look further ahead."
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
