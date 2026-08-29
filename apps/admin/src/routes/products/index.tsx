import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ImageOff, MoreHorizontal, Package, Pencil, Plus, SearchX, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { formatCount } from '@/lib/format'
import { useListParams } from '@/hooks/use-list-params'
import { useProducts } from '@/features/products/queries'
import { useBulkProducts, useDeleteProduct } from '@/features/products/mutations'
import { useBrands } from '@/features/brands/queries'
import { useCategoryTree } from '@/features/categories/queries'
import { flatten } from '@/features/categories/tree'
import type { Product } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge, STATUS_OPTIONS } from '@/components/status-badge'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BulkCategoryDialog } from './bulk-category-dialog'

type Filter = 'status' | 'brandId' | 'categoryId' | 'stock' | 'missingMedia'

const STOCK_OPTIONS = [
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
]

/**
 * The filter that used to be a "Missing images" tab. It belongs here rather
 * than above the search box: it narrows the list exactly like the other four,
 * so it should clear with them and show in the same place they do.
 */
const MEDIA_OPTIONS = [
  { value: 'true', label: 'Missing images' },
  { value: 'false', label: 'Has images' },
]

export default function ProductsPage() {
  const navigate = useNavigate()
  const params = useListParams<Filter>({
    defaultSort: 'created_at:desc',
    filters: ['status', 'brandId', 'categoryId', 'stock', 'missingMedia'],
  })

  const { data, isPending, isFetching, error } = useProducts(params.toQuery())
  const { data: brands } = useBrands({ limit: 100, sort: 'name:asc' })
  const { data: categoryTree } = useCategoryTree()

  const deleteProduct = useDeleteProduct()
  const bulk = useBulkProducts()

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [deleting, setDeleting] = React.useState<Product | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)
  const [bulkAction, setBulkAction] = React.useState<'archive' | 'delete' | null>(null)
  const [categoryDialog, setCategoryDialog] = React.useState(false)

  const rows = data?.data ?? []

  // A selection is only meaningful against the rows on screen. Paging or
  // filtering silently keeps ids the operator can no longer see, and a bulk
  // delete then reaches products they never looked at.
  const pageKey = JSON.stringify(params.toQuery())
  React.useEffect(() => {
    setSelected(new Set())
  }, [pageKey])

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))

  const categoryOptions = React.useMemo(
    () =>
      (categoryTree ? flatten(categoryTree) : []).map((row) => ({
        value: row.id,
        label: `${'  '.repeat(row.depth)}${row.category.name}`,
      })),
    [categoryTree],
  )

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteProduct.mutateAsync(deleting.id)
      toast.success(`${deleting.title} deleted`)
      setDeleting(null)
    } catch (err) {
      // 422 is the designed outcome, not a failure: this product has sold.
      // Keep the dialog open as the explanation.
      if (err instanceof ApiError && err.status === 422) {
        setDeleteBlock(err.reason ?? err.message)
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this product')
      setDeleting(null)
    }
  }

  const runBulk = async (action: string, categoryId?: string | null) => {
    const ids = [...selected]
    const result = await bulk.mutateAsync({ ids, action, categoryId })
    setSelected(new Set())

    // Partial success is the normal case for publish and delete, so the toast
    // says what actually happened rather than a flat "done".
    if (result.skipped.length === 0) {
      toast.success(`${formatCount(result.updated)} ${result.updated === 1 ? 'product' : 'products'} updated`)
      return
    }
    toast.warning(
      `${formatCount(result.updated)} updated, ${result.skipped.length} skipped`,
      { description: result.skipped.map((row) => `${row.title} — ${row.reason}`).join('; ') },
    )
  }

  const columns = React.useMemo<ColumnDef<Product>[]>(
    () => [
      {
        id: 'select',
        meta: { headerClassName: 'w-10', cellClassName: 'w-10' },
        header: () => (
          <div data-row-action>
            <Checkbox
              checked={allSelected}
              onCheckedChange={() =>
                setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
              }
              aria-label="Select all on this page"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div data-row-action>
            <Checkbox
              checked={selected.has(row.original.id)}
              onCheckedChange={() => toggle(row.original.id)}
              aria-label={`Select ${row.original.title}`}
            />
          </div>
        ),
      },
      {
        id: 'cover',
        header: '',
        meta: { headerClassName: 'w-14', cellClassName: 'w-14' },
        cell: ({ row }) =>
          row.original.coverUrl ? (
            <img
              src={row.original.coverUrl}
              alt=""
              loading="lazy"
              className="bg-muted size-10 rounded-md border object-cover"
            />
          ) : (
            <div
              className="bg-muted text-muted-foreground/60 flex size-10 items-center justify-center rounded-md border"
              title="No image"
            >
              <ImageOff className="size-4" aria-hidden />
            </div>
          ),
      },
      {
        accessorKey: 'title',
        header: 'Title',
        meta: { sortKey: 'title' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.title}</p>
            <p className="text-muted-foreground truncate font-mono text-xs">{row.original.slug}</p>
          </div>
        ),
      },
      {
        id: 'brand',
        header: 'Brand',
        cell: ({ row }) =>
          row.original.brand?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'category',
        header: 'Category',
        cell: ({ row }) =>
          row.original.categoryPath ? (
            <span className="text-sm">{row.original.categoryPath}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'variantCount',
        header: 'Variants',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) =>
          row.original.variantCount || <span className="text-muted-foreground">0</span>,
      },
      {
        accessorKey: 'totalStock',
        header: 'Stock',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) => (
          // Red at zero even when active, because active plus no stock is the
          // combination that quietly costs money.
          <span
            className={cn(
              row.original.totalStock === 0 && 'text-destructive font-medium',
            )}
          >
            {formatCount(row.original.totalStock)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { sortKey: 'status' },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: '',
        meta: { headerClassName: 'w-10', cellClassName: 'w-10 text-right' },
        cell: ({ row }) => {
          const product = row.original
          return (
            <div data-row-action>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Actions for ${product.title}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => void navigate(`/products/${product.id}`)}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setDeleteBlock(null)
                      setDeleting(product)
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allSelected, rows, selected],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="The catalogue. A product holds the shared story; its variants hold the SKUs, prices and stock."
        actions={
          <Button onClick={() => void navigate('/products/new')}>
            <Plus className="size-4" />
            Add product
          </Button>
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search title or SKU"
        showClear={params.isFiltered}
        onClear={params.clear}
      >
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          label="Brand"
          value={params.filters.brandId}
          onChange={(value) => params.setFilter('brandId', value)}
          options={(brands?.data ?? []).map((brand) => ({ value: brand.id, label: brand.name }))}
        />
        <FilterSelect
          label="Category"
          value={params.filters.categoryId}
          onChange={(value) => params.setFilter('categoryId', value)}
          options={categoryOptions}
          className="w-52"
        />
        <FilterSelect
          label="Stock"
          value={params.filters.stock}
          onChange={(value) => params.setFilter('stock', value)}
          options={STOCK_OPTIONS}
        />
        <FilterSelect
          label="Images"
          value={params.filters.missingMedia}
          onChange={(value) => params.setFilter('missingMedia', value)}
          options={MEDIA_OPTIONS}
        />
      </FilterBar>

      {selected.size > 0 && (
        <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <span className="text-sm font-medium">
            {formatCount(selected.size)} selected
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => void runBulk('publish')}>
            Publish
          </Button>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => setBulkAction('archive')}>
            Archive
          </Button>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => setCategoryDialog(true)}>
            Change category
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={bulk.isPending}
            onClick={() => setBulkAction('delete')}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isPending}
        error={error}
        getRowId={(product) => product.id}
        onRowClick={(product) => void navigate(`/products/${product.id}`)}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No products match those filters"
              description="Try a different search, or clear the filters to see everything."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No products yet"
              description="Add the first one. Brands, categories and variant options are already waiting for it."
              action={
                <Button size="sm" onClick={() => void navigate('/products/new')}>
                  <Plus className="size-4" />
                  Add product
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      {/*
        Two dialogs in one. Before the attempt it asks to confirm; after a 422
        it becomes the explanation. Retrying a blocked delete would fail
        identically, so there is no confirm button on that side.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleteBlock ? `Cannot delete ${deleting?.title}` : `Delete ${deleting?.title}?`}
        description={
          deleteBlock ??
          'This deletes its images, variants and stock. Products that have sold cannot be deleted — archive those instead.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => !open && setBulkAction(null)}
        title={
          bulkAction === 'delete'
            ? `Delete ${formatCount(selected.size)} products?`
            : `Archive ${formatCount(selected.size)} products?`
        }
        description={
          bulkAction === 'delete'
            ? 'Anything that has sold is skipped and reported back — the rest go, along with their images, variants and stock.'
            : 'Archived products disappear from the storefront but keep their history.'
        }
        confirmLabel={bulkAction === 'delete' ? 'Delete' : 'Archive'}
        variant="destructive"
        onConfirm={async () => {
          if (!bulkAction) return
          await runBulk(bulkAction)
          setBulkAction(null)
        }}
      />

      <BulkCategoryDialog
        open={categoryDialog}
        onOpenChange={setCategoryDialog}
        count={selected.size}
        onConfirm={async (categoryId) => {
          await runBulk('setCategory', categoryId)
          setCategoryDialog(false)
        }}
      />
    </div>
  )
}
