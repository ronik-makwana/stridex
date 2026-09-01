import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Check,
  CirclePlay,
  CircleStop,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  ShoppingBag,
  Tag,
  Trash2,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
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

/**
 * The same icon means the same kind of discount everywhere on this page: the
 * create menu, the type column and the combination column all read from here,
 * so a tag is always a product discount and a truck is always shipping.
 */
const KIND = {
  PRODUCT: { label: 'Product discount', short: 'product', icon: Tag },
  ORDER: { label: 'Order discount', short: 'order', icon: ShoppingBag },
  SHIPPING: { label: 'Shipping discount', short: 'shipping', icon: Truck },
} as const

/** Kind → the row field that says whether this discount stacks with that kind. */
const COMBINES_WITH = {
  PRODUCT: 'combinesWithProduct',
  ORDER: 'combinesWithOrder',
  SHIPPING: 'combinesWithShipping',
} as const

const KINDS = ['PRODUCT', 'ORDER', 'SHIPPING'] as const

/** "20% off · 3 products" — what it does and what it touches, in one column. */
function describe(discount: DiscountRow) {
  if (discount.kind !== 'PRODUCT') {
    const what = discount.kind === 'ORDER' ? 'the order' : 'delivery'
    return discount.type === 'PERCENT'
      ? `${Number(discount.value)}% off ${what}`
      : `₹${Number(discount.value)} off ${what}`
  }

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

/**
 * The code is the thing an operator hands to a customer, so it is copyable from
 * the list rather than only from the editor. `data-row-action` keeps the copy
 * from also opening the row.
 */
function CodeCell({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy the code')
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-sm">{code}</span>
      <div data-row-action>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-7"
          title={copied ? 'Copied' : 'Copy code'}
          aria-label={copied ? `${code} copied` : `Copy ${code}`}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}

/**
 * All three icons, always, so the column is a row of the same three slots on
 * every line: lit where this discount stacks with that kind, dimmed where it
 * does not. Showing only the lit ones would make "combines with shipping" and
 * "combines with product" look like different columns.
 */
function CombinationCell({ discount }: { discount: DiscountRow }) {
  const on = KINDS.filter((kind) => discount[COMBINES_WITH[kind]])

  return (
    <div className="flex items-center gap-1.5">
      {KINDS.map((kind) => {
        const Icon = KIND[kind].icon
        return (
          <Icon
            key={kind}
            className={cn(
              'size-4',
              discount[COMBINES_WITH[kind]] ? 'text-foreground' : 'text-muted-foreground/30',
            )}
            aria-hidden
          />
        )
      })}
      <span className="sr-only">
        {on.length
          ? `Combines with ${on.map((kind) => KIND[kind].short).join(', ')} discounts`
          : 'Does not combine'}
      </span>
    </div>
  )
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
        cell: ({ row }) => <CodeCell code={row.original.code} />,
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
        header: 'Eligibility',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.eligibility === 'ALL_CUSTOMERS'
              ? 'All customers'
              : `${row.original.customerCount} ${row.original.customerCount === 1 ? 'customer' : 'customers'}`}
          </span>
        ),
      },
      {
        id: 'kind',
        header: 'Type',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{KIND[row.original.kind].label}</span>
        ),
      },
      {
        id: 'combination',
        header: 'Combination',
        cell: ({ row }) => <CombinationCell discount={row.original} />,
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
          /*
            The kind is chosen here rather than inside the form, because it
            decides which questions the form asks. Shipping discounts are listed
            and disabled: the shape of the feature is obvious from day one,
            rather than a menu that grows later.
          */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="size-4" />
                Create discount
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void navigate('/discounts/new')}>
                <Tag className="size-4" />
                <span>
                  Product discount
                  <span className="text-muted-foreground block text-xs">
                    Off chosen products
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate('/discounts/new?kind=ORDER')}>
                <ShoppingBag className="size-4" />
                <span>
                  Order discount
                  <span className="text-muted-foreground block text-xs">Off the whole cart</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate('/discounts/new?kind=SHIPPING')}>
                <Truck className="size-4" />
                <span>
                  Shipping discount
                  <span className="text-muted-foreground block text-xs">Off the delivery charge</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
