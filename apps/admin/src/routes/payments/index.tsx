import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { CreditCard } from 'lucide-react'
import { useListParams } from '@/hooks/use-list-params'
import { usePayments } from '@/features/payments/queries'
import { formatDateTime, formatMoney } from '@/lib/format'
import type { PaymentRow } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { PAYMENT_RECORD_OPTIONS, PaymentRecordBadge } from '@/components/order-status-badge'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'

/**
 * Read-only, and it stays that way at launch. Every mutation on a payment
 * arrives through a provider webhook — a refund button here would report
 * something the provider has not agreed to (§8).
 */
export default function PaymentsPage() {
  const navigate = useNavigate()
  const params = useListParams<'status'>({ defaultSort: 'created_at:desc', filters: ['status'] })
  const { data, isPending, isFetching, error } = usePayments(params.toQuery())

  const columns = React.useMemo<ColumnDef<PaymentRow>[]>(
    () => [
      {
        accessorKey: 'providerPaymentId',
        header: 'Payment',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.providerPaymentId}</span>
        ),
      },
      {
        id: 'order',
        header: 'Order',
        cell: ({ row }) =>
          row.original.order ? (
            <Link
              to={`/orders/${row.original.order.id}`}
              onClick={(event) => event.stopPropagation()}
              className="text-sm tabular-nums underline underline-offset-4"
            >
              {row.original.order.orderNumber}
            </Link>
          ) : (
            // A payment can outlive its order, and does between the attempt and
            // the webhook. An em dash is the honest answer.
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      { accessorKey: 'provider', header: 'Provider' },
      {
        accessorKey: 'method',
        header: 'Method',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.method ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        meta: { sortKey: 'amount' },
        cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.amount)}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        meta: { sortKey: 'created_at' },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <PaymentRecordBadge status={row.original.status} />,
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        description="Written by the provider's webhook. Read-only — refunds happen at the provider."
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search provider id or order number"
        onClear={params.clear}
        showClear={params.isFiltered}
      >
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={PAYMENT_RECORD_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        getRowId={(payment) => payment.id}
        onRowClick={(payment) => void navigate(`/payments/${payment.id}`)}
        empty={
          <EmptyState
            icon={params.isFiltered ? undefined : CreditCard}
            title={params.isFiltered ? 'No payments match these filters' : 'No payments yet'}
            description={
              params.isFiltered
                ? 'Clear the filters to see everything.'
                : 'Every attempt a customer makes appears here, successful or not.'
            }
          />
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />
    </div>
  )
}
