import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CirclePlay,
  CircleStop,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  Tag,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { formatDate } from '@/lib/format'
import { useListParams } from '@/hooks/use-list-params'
import { useDiscounts } from '@/features/discounts/queries'
import { useDeleteDiscount, useSetDiscountState } from '@/features/discounts/mutations'
import type { DiscountRow } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DiscountStateBadge, DISCOUNT_STATE_OPTIONS } from './state-badge'

const KIND_OPTIONS = [
  { value: 'PRODUCT', label: 'Product' },
  { value: 'ORDER', label: 'Order' },
  { value: 'SHIPPING', label: 'Shipping' },
]

/** "20% off · 3 products" — what it does and what it touches, in one column. */
function describe(discount: DiscountRow) {
  const value =
    discount.type === 'PERCENT'
      ? `${Number(discount.value)}% off`
      : `₹${Number(discount.value)} off`

  const noun =
    discount.appliesTo === 'PRODUCTS'
      ? discount.targetCount === 1
        ? 'product'
        : 'products'
      : discount.appliesTo === 'CATEGORIES'
        ? discount.targetCount === 1
          ? 'category'
          : 'categories'
        : discount.targetCount === 1
          ? 'collection'
          : 'collections'

  return discount.appliesTo ? `${value} · ${discount.targetCount} ${noun}` : value
}

export default function DiscountsPage() {
  const navigate = useNavigate()
  const params = useListParams<'kind' | 'state'>({
    defaultSort: 'created_at:desc',
    filters: ['kind', 'state'],
  })

  const { data, isPending, isFetching, error } = useDiscounts(params.toQuery())
  const setState = useSetDiscountState()
  const deleteDiscount = useDeleteDiscount()

  const [deleting, setDeleting] = React.useState<DiscountRow | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteDiscount.mutateAsync(deleting.id)
      toast.success(`${deleting.code} deleted`)
    } catch (err) {
      // A used discount answers 409 with why — it is history now, not clutter.
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this discount')
    } finally {
      setDeleting(null)
    }
  }

  /**
   * The same one slot as the editor's More actions: a discount is running or it
   * is not, and the verb follows from which.
   */
  const toggleState = async (discount: DiscountRow) => {
    const action = discount.state === 'EXPIRED' ? 'ACTIVATE' : 'DEACTIVATE'
    try {
      await setState.mutateAsync({ id: discount.id, action })
      toast.success(
        action === 'ACTIVATE' ? `${discount.code} is live` : `${discount.code} ended just now`,
      )
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change that')
    }
  }

  const columns = React.useMemo<ColumnDef<DiscountRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'Code',
        meta: { sortKey: 'code' },
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      {
        id: 'value',
        header: 'Discount',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{describe(row.original)}</span>
        ),
      },
      {
        id: 'eligibility',
        header: 'Customers',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.eligibility === 'ALL_CUSTOMERS'
              ? 'All'
              : `${row.original.customerCount} chosen`}
          </span>
        ),
      },
      {
        accessorKey: 'usedCount',
        header: 'Used',
        meta: {
          sortKey: 'used_count',
          headerClassName: 'text-right',
          cellClassName: 'text-right tabular-nums',
        },
        cell: ({ row }) =>
          row.original.usageLimit
            ? `${row.original.usedCount} / ${row.original.usageLimit}`
            : row.original.usedCount,
      },
      {
        id: 'window',
        header: 'Active',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.startsAt)}
            {row.original.endsAt ? ` – ${formatDate(row.original.endsAt)}` : ' onwards'}
          </span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'Status',
        cell: ({ row }) => <DiscountStateBadge state={row.original.state} />,
      },
      {
        id: 'actions',
        header: '',
        meta: { headerClassName: 'w-10', cellClassName: 'w-10 text-right' },
        cell: ({ row }) => (
          <div data-row-action>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${row.original.code}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => void navigate(`/discounts/${row.original.id}`)}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void toggleState(row.original)}>
                  {row.original.state === 'EXPIRED' ? (
                    <>
                      <CirclePlay className="size-4" />
                      Activate
                    </>
                  ) : (
                    <>
                      <CircleStop className="size-4" />
                      Deactivate
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row.original)}>
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Discounts"
        description="Codes customers type at checkout. The rules are stored here; the money is worked out at checkout."
        actions={
          <Button onClick={() => void navigate('/discounts/new')}>
            <Plus className="size-4" />
            Create discount
          </Button>
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search code"
        showClear={params.isFiltered}
        onClear={params.clear}
      >
        <FilterSelect
          label="Kind"
          value={params.filters.kind}
          onChange={(value) => params.setFilter('kind', value)}
          options={KIND_OPTIONS}
        />
        <FilterSelect
          label="Status"
          value={params.filters.state}
          onChange={(value) => params.setFilter('state', value)}
          options={DISCOUNT_STATE_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        getRowId={(discount) => discount.id}
        onRowClick={(discount) => void navigate(`/discounts/${discount.id}`)}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No discounts match those filters"
              description="Try a different search, or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Tag}
              title="No discounts yet"
              description="Create a code for a campaign, a launch, or a set of customers."
              action={
                <Button size="sm" onClick={() => void navigate('/discounts/new')}>
                  <Plus className="size-4" />
                  Create discount
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code}?`}
        description="A discount that has already been used cannot be deleted — archive it instead, so the orders it discounted still explain themselves."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
