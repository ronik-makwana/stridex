import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertCircle,
  Boxes,
  ImageOff,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { formatCount } from '@/lib/format'
import { useListParams } from '@/hooks/use-list-params'
import { useCollections } from '@/features/collections/queries'
import { useDeleteCollection } from '@/features/collections/mutations'
import type { Collection } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge, STATUS_OPTIONS } from '@/components/status-badge'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TYPE_OPTIONS = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'DYNAMIC', label: 'Dynamic' },
]

export default function CollectionsPage() {
  const navigate = useNavigate()
  const params = useListParams<'type' | 'status'>({
    defaultSort: 'name:asc',
    filters: ['type', 'status'],
  })

  const { data, isPending, isFetching, error } = useCollections(params.toQuery())
  const deleteCollection = useDeleteCollection()

  const [deleting, setDeleting] = React.useState<Collection | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteCollection.mutateAsync(deleting.id)
      toast.success(`${deleting.name} deleted`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this collection')
    } finally {
      setDeleting(null)
    }
  }

  const columns = React.useMemo<ColumnDef<Collection>[]>(
    () => [
      {
        id: 'image',
        header: '',
        meta: { headerClassName: 'w-14', cellClassName: 'w-14' },
        cell: ({ row }) =>
          row.original.imageUrl ? (
            <img
              src={row.original.imageUrl}
              alt=""
              loading="lazy"
              className="bg-muted size-10 rounded-md border object-cover"
            />
          ) : (
            // A placeholder rather than nothing: without it the rows beside an
            // image-less collection shift left and the column stops being one.
            <div
              className="bg-muted text-muted-foreground/60 flex size-10 items-center justify-center rounded-md border"
              title="No image"
            >
              <ImageOff className="size-4" aria-hidden />
            </div>
          ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        // Capped so a long description truncates instead of pushing the
        // status and actions columns off the row.
        meta: { sortKey: 'name', cellClassName: 'max-w-[28rem]' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            {row.original.description && (
              <p
                className="text-muted-foreground truncate text-xs"
                title={row.original.description}
              >
                {row.original.description}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        meta: { sortKey: 'type' },
        cell: ({ row }) => (
          <Badge variant={row.original.type === 'DYNAMIC' ? 'secondary' : 'muted'}>
            {row.original.type === 'DYNAMIC' ? 'Dynamic' : 'Manual'}
          </Badge>
        ),
      },
      {
        accessorKey: 'productCount',
        header: 'Products',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) =>
          // A rule pointing at something deleted is surfaced, not swallowed —
          // otherwise a broken collection is indistinguishable from an empty one.
          row.original.ruleError ? (
            <span
              className="text-destructive inline-flex items-center gap-1"
              title={row.original.ruleError}
            >
              <AlertCircle className="size-3.5" />
              —
            </span>
          ) : (
            formatCount(row.original.productCount)
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
        cell: ({ row }) => (
          <div data-row-action>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${row.original.name}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onSelect={() => void navigate(`/collections/${row.original.id}`)}
                >
                  <Pencil className="size-4" />
                  Edit
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
        title="Collections"
        description="Merchandising. Manual collections are curated by hand; dynamic ones follow rules and keep themselves current."
        actions={
          <Button onClick={() => void navigate('/collections/new')}>
            <Plus className="size-4" />
            Add collection
          </Button>
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search name or slug"
        showClear={params.isFiltered}
        onClear={params.clear}
      >
        <FilterSelect
          label="Type"
          value={params.filters.type}
          onChange={(value) => params.setFilter('type', value)}
          options={TYPE_OPTIONS}
        />
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        getRowId={(collection) => collection.id}
        onRowClick={(collection) => void navigate(`/collections/${collection.id}`)}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No collections match those filters"
              description="Try a different search, or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="No collections yet"
              description="Group products for a campaign, a landing page, or a shelf on the home page."
              action={
                <Button size="sm" onClick={() => void navigate('/collections/new')}>
                  <Plus className="size-4" />
                  Add collection
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      {/* No 422 branch here: a collection is a grouping, so deleting one
          removes an arrangement of products and never a product. */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="The products themselves are untouched — only this grouping goes."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
