import { Link } from 'react-router'
import { PackageOpen } from 'lucide-react'
import { useListParams } from '@/hooks/use-list-params'
import { useReturns } from '@/features/returns/queries'
import { formatDate, formatMoney } from '@/lib/format'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { REFUND_REASON_LABELS, ReturnStatusBadge } from '@/components/refund-labels'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'REQUESTED', label: 'Awaiting decision' },
  { value: 'APPROVED', label: 'Awaiting parcel' },
  { value: 'RECEIVED', label: 'Parcel received' },
  { value: 'COMPLETED', label: 'Refunded' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
]

const TYPE_OPTIONS = [
  { value: 'RETURN', label: 'Returns' },
  { value: 'CANCELLATION', label: 'Cancellations' },
]

/**
 * The returns queue.
 *
 * Oldest first by default, unlike every other list in the admin. A return is
 * somebody waiting — for a decision, or for money — and the one that has waited
 * longest is the one to do next. Sorting newest-first would bury exactly the
 * row this screen exists to surface.
 *
 * Cancellations appear here too, already decided. They need nothing from
 * anybody, but "what has been sent back and why" is one question, and answering
 * it from two screens is how a refund goes unnoticed for a week.
 */
export default function ReturnsPage() {
  const params = useListParams<'status' | 'type'>({
    defaultSort: 'created_at:asc',
    filters: ['status', 'type'],
  })
  const { data, isPending } = useReturns(params.toQuery())

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns"
        description="What customers asked to send back, and what has been decided."
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Order number or customer email"
        onClear={params.clear}
        showClear={params.isFiltered}
      >
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          label="Type"
          value={params.filters.type}
          onChange={(value) => params.setFilter('type', value)}
          options={TYPE_OPTIONS}
        />
      </FilterBar>

      {isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : (data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={params.isFiltered ? undefined : PackageOpen}
          title={params.isFiltered ? 'Nothing matches these filters' : 'Nothing has been sent back'}
          description={
            params.isFiltered
              ? 'Clear the filters to see everything.'
              : 'Returns raised by customers land here for a decision.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {data?.data.map((request) => (
            <li key={request.id}>
              <Link
                to={`/returns/${request.id}`}
                className={cn(
                  'bg-card hover:border-foreground/25 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-4 transition-colors',
                  // What is waiting on a person reads first. Everything else is
                  // a record rather than a task.
                  request.status === 'REQUESTED' && 'border-foreground/20',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{request.order.orderNumber}</span>
                    <ReturnStatusBadge status={request.status} />
                    {request.type === 'CANCELLATION' && <Badge variant="muted">Cancellation</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-sm">
                    {request.customer.name ?? request.customer.email} ·{' '}
                    {REFUND_REASON_LABELS[request.reason]} · {request.itemCount}{' '}
                    {request.itemCount === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular-nums">{formatMoney(request.estimatedAmount)}</p>
                  <p className="text-muted-foreground text-xs">{formatDate(request.createdAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && data.meta.totalPages > 1 && (
        <DataTablePagination meta={data.meta} onPageChange={params.setPage} />
      )}
    </div>
  )
}
