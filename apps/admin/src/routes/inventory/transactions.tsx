import { useListParams } from '@/hooks/use-list-params'
import { useInventoryLedger } from '@/features/inventory/queries'
import type { InventoryTransaction } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StockLedger } from './stock-ledger'

type Filter = 'type' | 'from' | 'to'

const TYPE_OPTIONS: { value: InventoryTransaction['type']; label: string }[] = [
  { value: 'RESTOCK', label: 'Restock' },
  { value: 'SALE', label: 'Sale' },
  { value: 'RESERVATION', label: 'Reservation' },
  { value: 'RELEASE', label: 'Release' },
  { value: 'RETURN', label: 'Return' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
]

/**
 * The whole ledger, every SKU. The one screen that answers "where did those
 * units go" — which is why it is filterable by type and date range rather than
 * only by product.
 */
export default function InventoryTransactionsPage() {
  const params = useListParams<Filter>({
    // The ledger has no sortable columns: it is chronological by definition,
    // and a ledger you can re-sort is a ledger you can misread.
    defaultSort: '',
    defaultLimit: 50,
    filters: ['type', 'from', 'to'],
  })

  const { q, filters, page, limit } = params
  const { data, isPending, isFetching } = useInventoryLedger({
    page,
    limit,
    ...(q ? { q } : {}),
    ...(filters.type ? { type: filters.type as InventoryTransaction['type'] } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/inventory"
        backLabel="Back to inventory"
        title="Stock ledger"
        description="Append-only. Every movement, what caused it, and who was responsible."
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search SKU or product"
        showClear={params.isFiltered}
        onClear={params.clear}
      >
        <FilterSelect
          label="Type"
          value={params.filters.type}
          onChange={(value) => params.setFilter('type', value)}
          options={TYPE_OPTIONS}
        />

        <div className="flex items-center gap-1.5">
          <Label htmlFor="from" className="text-muted-foreground text-xs">
            From
          </Label>
          <Input
            id="from"
            type="date"
            value={params.filters.from ?? ''}
            onChange={(event) => params.setFilter('from', event.target.value || undefined)}
            className="h-8 w-36"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="to" className="text-muted-foreground text-xs">
            To
          </Label>
          <Input
            id="to"
            type="date"
            value={params.filters.to ?? ''}
            onChange={(event) => params.setFilter('to', event.target.value || undefined)}
            className="h-8 w-36"
          />
        </div>
      </FilterBar>

      <StockLedger
        transactions={data?.data ?? []}
        meta={data?.meta}
        isLoading={isPending}
        isFetching={isFetching}
        onPageChange={params.setPage}
        emptyDescription="Nothing has moved in this range. Widen the dates, or clear the filters."
      />
    </div>
  )
}
