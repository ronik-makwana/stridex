import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Users } from 'lucide-react'
import { useListParams } from '@/hooks/use-list-params'
import { useCustomers } from '@/features/customers/queries'
import { formatDate, formatMoney } from '@/lib/format'
import type { Customer } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Badge } from '@/components/ui/badge'

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
]

const VERIFIED_OPTIONS = [
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
]

/**
 * Support's list. Two things make it useful on a phone call: searching by
 * whatever the customer says — name, email, number — and the lifetime value
 * beside each row, which is the question that follows every complaint.
 */
export default function CustomersPage() {
  const navigate = useNavigate()
  const params = useListParams<'status' | 'verified'>({
    defaultSort: 'created_at:desc',
    filters: ['status', 'verified'],
  })
  const { data, isPending, isFetching, error } = useCustomers(params.toQuery())

  const columns = React.useMemo<ColumnDef<Customer>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{row.original.name ?? '—'}</p>
            <p className="text-muted-foreground truncate text-xs">{row.original.email}</p>
          </div>
        ),
      },
      {
        accessorKey: 'orderCount',
        header: 'Orders',
        cell: ({ row }) => <span className="tabular-nums">{row.original.orderCount}</span>,
      },
      {
        accessorKey: 'totalSpent',
        header: 'Spent',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(row.original.totalSpent)}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          if (row.original.status === 'SUSPENDED') {
            return <Badge variant="destructive">Suspended</Badge>
          }
          // Unverified is not a status column — it is the absence of a
          // verification timestamp, and it is the first thing support checks.
          return row.original.emailVerified ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="muted">Unverified</Badge>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: 'Joined',
        meta: { sortKey: 'created_at' },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{formatDate(row.original.createdAt)}</span>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" description="Everyone who has an account. Staff are managed in settings." />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search name, email or phone"
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
          label="Email"
          value={params.filters.verified}
          onChange={(value) => params.setFilter('verified', value)}
          options={VERIFIED_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        getRowId={(customer) => customer.id}
        onRowClick={(customer) => void navigate(`/customers/${customer.id}`)}
        empty={
          <EmptyState
            icon={params.isFiltered ? undefined : Users}
            title={params.isFiltered ? 'No customers match these filters' : 'No customers yet'}
            description={
              params.isFiltered ? 'Clear the filters to see everyone.' : 'Accounts appear here as people sign up.'
            }
          />
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />
    </div>
  )
}
