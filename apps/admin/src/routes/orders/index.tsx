import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ShoppingCart } from 'lucide-react'
import { useListParams } from '@/hooks/use-list-params'
import { useOrders } from '@/features/orders/queries'
import { formatDate, formatMoney } from '@/lib/format'
import type { OrderRow } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import {
  ORDER_STATUS_OPTIONS,
  OrderStatusBadge,
  PAYMENT_STATUS_OPTIONS,
  PaymentStatusBadge,
} from '@/components/order-status-badge'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'

/**
 * Two status columns, deliberately. Payment and fulfilment are different
 * questions and get filtered separately — "who has not paid" and "what needs
 * packing" are two different mornings' work (§11).
 *
 * There is no "new order" button and there never will be: orders are created by
 * the payment webhook. One typed in by hand would be an order with no money
 * behind it and no stock accounted for.
 */
export default function OrdersPage() {
  const navigate = useNavigate()
  const params = useListParams<'status' | 'paymentStatus'>({
    defaultSort: 'created_at:desc',
    filters: ['status', 'paymentStatus'],
  })

  const { data, isPending, isFetching, error } = useOrders(params.toQuery())

  const columns = React.useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        accessorKey: 'orderNumber',
        header: 'Order',
        meta: { sortKey: 'order_number' },
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">{row.original.orderNumber}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        meta: { sortKey: 'created_at' },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.placedAt ?? row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'customer',
        header: 'Customer',
        cell: ({ row }) => {
          const customer = row.original.customer
          if (!customer) return <span className="text-muted-foreground text-sm">Guest</span>
          return (
            <div className="min-w-0">
              <p className="truncate text-sm">{customer.name ?? customer.email}</p>
              {customer.name && (
                <p className="text-muted-foreground truncate text-xs">{customer.email}</p>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'itemCount',
        header: 'Items',
        cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span>,
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total',
        meta: { sortKey: 'total_amount' },
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(row.original.totalAmount)}</span>
        ),
      },
      {
        accessorKey: 'paymentStatus',
        header: 'Payment',
        cell: ({ row }) => <PaymentStatusBadge status={row.original.paymentStatus} />,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Orders" description="Placed by customers. Created by the payment webhook, never by hand." />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search order number, name or email"
        onClear={params.clear}
        showClear={params.isFiltered}
      >
        <FilterSelect
          label="Payment"
          value={params.filters.paymentStatus}
          onChange={(value) => params.setFilter('paymentStatus', value)}
          options={PAYMENT_STATUS_OPTIONS}
        />
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={ORDER_STATUS_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        getRowId={(order) => order.id}
        onRowClick={(order) => void navigate(`/orders/${order.id}`)}
        empty={
          <EmptyState
            icon={params.isFiltered ? undefined : ShoppingCart}
            title={params.isFiltered ? 'No orders match these filters' : 'No orders yet'}
            description={
              params.isFiltered
                ? 'Clear the filters to see everything.'
                : 'Orders appear here the moment a payment is confirmed.'
            }
          />
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />
    </div>
  )
}
