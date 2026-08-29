import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, ListChecks, Minus, MoreHorizontal, Pencil, Plus, SearchX, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useListParams } from '@/hooks/use-list-params'
import { useAttributes } from '@/features/attributes/queries'
import { useDeleteAttribute } from '@/features/attributes/mutations'
import { isListAttributeType, type Attribute } from '@/types/api'
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
import { AttributeModal } from './attribute-modal'
import { ATTRIBUTE_TYPE_OPTIONS, AttributeTypeBadge } from './attribute-type'

const FILTERS = ['type', 'isFilterable'] as const

const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

/** A tick or a dash, so a column of flags scans as a column rather than as text. */
function Flag({ on }: { on: boolean }) {
  return on ? (
    <Check className="size-4" aria-label="Yes" />
  ) : (
    <Minus className="text-muted-foreground/50 size-4" aria-label="No" />
  )
}

export default function AttributesPage() {
  const navigate = useNavigate()
  const params = useListParams<(typeof FILTERS)[number]>({
    defaultSort: 'name:asc',
    filters: FILTERS,
  })

  const { data, isPending, isFetching, error } = useAttributes(params.toQuery())
  const deleteAttribute = useDeleteAttribute()

  const [modalOpen, setModalOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Attribute | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  const openDetail = (attribute: Attribute) => void navigate(`/attributes/${attribute.id}`)

  const askDelete = (attribute: Attribute) => {
    setDeleteBlock(null)
    setDeleting(attribute)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteAttribute.mutateAsync(deleting.id)
      toast.success(`${deleting.name} deleted`)
      setDeleting(null)
    } catch (err) {
      // 422 is the designed outcome, not a failure: products still hold values
      // for this attribute. Keep the dialog open as the explanation.
      if (err instanceof ApiError && err.status === 422) {
        setDeleteBlock(err.reason ?? err.message)
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this attribute')
      setDeleting(null)
    }
  }

  const columns = React.useMemo<ColumnDef<Attribute>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-muted-foreground ml-2 font-mono text-xs">
              {row.original.slug}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        meta: { sortKey: 'type' },
        cell: ({ row }) => <AttributeTypeBadge type={row.original.type} />,
      },
      {
        accessorKey: 'valueCount',
        header: 'Values',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) =>
          // A TEXT or NUMBER attribute has no value list at all, which is a
          // different thing from a SELECT that has none yet.
          isListAttributeType(row.original.type) ? (
            row.original.valueCount || <span className="text-muted-foreground">0</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'isFilterable',
        header: 'Filterable',
        meta: { headerClassName: 'w-24', cellClassName: 'w-24' },
        cell: ({ row }) => <Flag on={row.original.isFilterable} />,
      },
      {
        accessorKey: 'isSuggested',
        header: 'Suggested',
        meta: { headerClassName: 'w-24', cellClassName: 'w-24' },
        cell: ({ row }) => <Flag on={row.original.isSuggested} />,
      },
      {
        accessorKey: 'productCount',
        header: 'Products',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) =>
          row.original.productCount || <span className="text-muted-foreground">0</span>,
      },
      {
        id: 'actions',
        header: '',
        meta: { headerClassName: 'w-10', cellClassName: 'w-10 text-right' },
        cell: ({ row }) => {
          const attribute = row.original
          return (
            <div data-row-action>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Actions for ${attribute.name}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => openDetail(attribute)}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => askDelete(attribute)}>
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
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attributes"
        description="What a product is — material, gender, weight. Variants are built from options, not these."
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Add attribute
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
          options={ATTRIBUTE_TYPE_OPTIONS}
          className="w-44"
        />
        <FilterSelect
          label="Filterable"
          value={params.filters.isFilterable}
          onChange={(value) => params.setFilter('isFilterable', value)}
          options={YES_NO_OPTIONS}
          className="w-40"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        getRowId={(attribute) => attribute.id}
        onRowClick={openDetail}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No attributes match those filters"
              description="Try a different search term, or clear the filters to see everything."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No attributes yet"
              description="Add Material or Gender first — they are what storefront filters are built from."
              action={
                <Button size="sm" onClick={() => setModalOpen(true)}>
                  <Plus className="size-4" />
                  Add attribute
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      <AttributeModal open={modalOpen} onOpenChange={setModalOpen} />

      {/*
        Two dialogs in one. Before the attempt it asks to confirm; after a 422
        it becomes the explanation. Retrying a blocked delete would fail
        identically, so there is no confirm button on that side — unlike a
        brand, an attribute has no status to fall back to.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleteBlock ? `Cannot delete ${deleting?.name}` : `Delete ${deleting?.name}?`}
        description={
          deleteBlock ??
          'This deletes its values too. Attributes in use by products cannot be deleted.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
