import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Archive, CircleDot, MoreHorizontal, Pencil, Plus, SearchX, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useListParams } from '@/hooks/use-list-params'
import { useBrands } from '@/features/brands/queries'
import { useDeleteBrand, useSetBrandStatus } from '@/features/brands/mutations'
import type { Brand, EntityStatus } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge, STATUS_OPTIONS } from '@/components/status-badge'
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
import { BrandModal } from './brand-modal'
import { BrandLogo } from './brand-logo'

const FILTERS = ['status'] as const

export default function BrandsPage() {
  const params = useListParams<(typeof FILTERS)[number]>({
    defaultSort: 'name:asc',
    filters: FILTERS,
  })

  const { data, isPending, isFetching, error } = useBrands(params.toQuery())
  const setStatus = useSetBrandStatus()
  const deleteBrand = useDeleteBrand()

  const [editing, setEditing] = React.useState<Brand | undefined>()
  const [modalOpen, setModalOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Brand | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  const openCreate = () => {
    setEditing(undefined)
    setModalOpen(true)
  }

  const openEdit = (brand: Brand) => {
    setEditing(brand)
    setModalOpen(true)
  }

  const askDelete = (brand: Brand) => {
    setDeleteBlock(null)
    setDeleting(brand)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteBrand.mutateAsync(deleting.id)
      toast.success(`${deleting.name} deleted`)
      setDeleting(null)
    } catch (err) {
      // 422 is the designed outcome, not a failure: the brand still has
      // products. Keep the dialog open and turn it into the explanation.
      if (err instanceof ApiError && err.status === 422) {
        setDeleteBlock(err.reason ?? err.message)
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this brand')
      setDeleting(null)
    }
  }

  // An already-draft brand has nowhere to go, so the dialog is Close-only.
  const canSetDraft = Boolean(deleteBlock) && deleting?.status !== 'DRAFT'

  const columns = React.useMemo<ColumnDef<Brand>[]>(
    () => [
      {
        id: 'logo',
        header: 'Logo',
        meta: { headerClassName: 'w-14', cellClassName: 'w-14' },
        cell: ({ row }) => (
          <BrandLogo name={row.original.name} logoUrl={row.original.logoUrl} />
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'slug',
        header: 'Slug',
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">{row.original.slug}</span>
        ),
      },
      {
        accessorKey: 'productCount',
        header: 'Products',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
        cell: ({ row }) =>
          row.original.productCount || <span className="text-muted-foreground">0</span>,
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
          const brand = row.original
          // Always offer the status the brand is not currently in.
          const nextStatus: EntityStatus = brand.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'

          return (
            <div data-row-action>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${brand.name}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => openEdit(brand)}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setStatus.mutate({ id: brand.id, status: nextStatus })}
                  >
                    {nextStatus === 'ACTIVE' ? (
                      <CircleDot className="size-4" />
                    ) : (
                      <Archive className="size-4" />
                    )}
                    Set to {nextStatus === 'ACTIVE' ? 'active' : 'draft'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => askDelete(brand)}>
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
    [setStatus],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Brands"
        description="Every product belongs to a brand. Only active brands reach the storefront."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add brand
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
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={STATUS_OPTIONS}
          className="w-40"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isPending}
        error={error}
        getRowId={(brand) => brand.id}
        onRowClick={openEdit}
        sorting={{ sort: params.sort, onSortChange: params.setSort }}
        empty={
          params.isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No brands match those filters"
              description="Try a different search term, or clear the filters to see everything."
              action={
                <Button variant="outline" size="sm" onClick={params.clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Tags}
              title="No brands yet"
              description="Add the first brand, then products can be assigned to it."
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus className="size-4" />
                  Add brand
                </Button>
              }
            />
          )
        }
      />

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      <BrandModal open={modalOpen} onOpenChange={setModalOpen} brand={editing} />

      {/*
        Two dialogs in one. Before the attempt it asks to confirm; after a 422
        it becomes the explanation. Retrying a blocked delete would fail
        identically, so the primary action becomes the way forward instead —
        setting the brand to draft hides it from the storefront, which is
        almost always what was actually wanted.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleteBlock ? `Cannot delete ${deleting?.name}` : `Delete ${deleting?.name}?`}
        description={
          deleteBlock ??
          'This cannot be undone. Brands with products attached cannot be deleted.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? (canSetDraft ? 'Set to draft' : undefined) : 'Delete'}
        variant={deleteBlock ? 'default' : 'destructive'}
        onConfirm={
          deleteBlock
            ? async () => {
                await setStatus.mutateAsync({ id: deleting!.id, status: 'DRAFT' })
                setDeleting(null)
              }
            : confirmDelete
        }
      />
    </div>
  )
}
