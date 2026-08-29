import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Layers, MoreHorizontal, Pencil, Plus, SearchX, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useListParams } from '@/hooks/use-list-params'
import { useVariantOptions } from '@/features/variant-options/queries'
import { useDeleteVariantOption } from '@/features/variant-options/mutations'
import type { VariantOption } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar } from '@/components/data-table/filter-bar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { VariantOptionModal } from './variant-option-modal'

export default function VariantOptionsPage() {
  const navigate = useNavigate()
  const params = useListParams({ defaultSort: 'position:asc' })

  const { data, isPending, isFetching, error } = useVariantOptions(params.toQuery())
  const deleteOption = useDeleteVariantOption()

  const [modalOpen, setModalOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<VariantOption | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  const openDetail = (option: VariantOption) => void navigate(`/variant-options/${option.id}`)

  const askDelete = (option: VariantOption) => {
    setDeleteBlock(null)
    setDeleting(option)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteOption.mutateAsync(deleting.id)
      toast.success(`${deleting.name} deleted`)
      setDeleting(null)
    } catch (err) {
      // 422 is the designed outcome, not a failure: products are still built on
      // this option. Keep the dialog open as the explanation.
      if (err instanceof ApiError && err.status === 422) {
        setDeleteBlock(err.reason ?? err.message)
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this option')
      setDeleting(null)
    }
  }

  const columns = React.useMemo<ColumnDef<VariantOption>[]>(
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
        accessorKey: 'valueCount',
        header: 'Values',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) =>
          row.original.valueCount || <span className="text-muted-foreground">0</span>,
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
          const option = row.original
          return (
            <div data-row-action>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Actions for ${option.name}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => openDetail(option)}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => askDelete(option)}>
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
        title="Variant options"
        description="What variants are built from — Colour, Size. Each product picks the options it uses and in what order."
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Add option
          </Button>
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search name or slug"
        showClear={params.isFiltered}
        onClear={params.clear}
      />

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        getRowId={(option) => option.id}
        onRowClick={openDetail}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No options match that search"
              description="Try a different term, or clear it to see everything."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Layers}
              title="No variant options yet"
              description="Add Colour and Size first — a product cannot generate variants without them."
              action={
                <Button size="sm" onClick={() => setModalOpen(true)}>
                  <Plus className="size-4" />
                  Add option
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      <VariantOptionModal open={modalOpen} onOpenChange={setModalOpen} />

      {/*
        Two dialogs in one. Before the attempt it asks to confirm; after a 422
        it becomes the explanation. Retrying a blocked delete would fail
        identically, so there is no confirm button on that side.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleteBlock ? `Cannot delete ${deleting?.name}` : `Delete ${deleting?.name}?`}
        description={
          deleteBlock ??
          'This deletes its values too. Options used by products cannot be deleted.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
