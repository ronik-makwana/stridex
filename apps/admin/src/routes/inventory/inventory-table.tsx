import * as React from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { History, MoreHorizontal, PackagePlus, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCount } from '@/lib/format'
import type { InventoryRow } from '@/types/api'
import { DataTable } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { StockTarget } from './adjust-stock-dialog'

export const toTarget = (row: InventoryRow): StockTarget => ({
  variantId: row.variantId,
  sku: row.sku,
  quantity: row.quantity,
  reserved: row.reserved,
})

/**
 * On hand, reserved and available, always all three. Zero available against
 * twenty on hand is only comprehensible when the twenty reservations are on the
 * same row — showing "available" alone turns a normal state into an alarm, and
 * showing "on hand" alone hides a real one.
 */
export function InventoryTable({
  rows,
  isLoading,
  error,
  sorting,
  empty,
  onAdjust,
  onRestock,
}: {
  rows: InventoryRow[]
  isLoading?: boolean
  error?: Error | null
  sorting: { sort: string; onSortChange: (sort: string) => void }
  empty: React.ReactNode
  onAdjust: (row: InventoryRow) => void
  onRestock: (row: InventoryRow) => void
}) {
  const navigate = useNavigate()

  const columns = React.useMemo<ColumnDef<InventoryRow>[]>(
    () => [
      {
        accessorKey: 'sku',
        header: 'SKU',
        meta: { sortKey: 'sku' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
      },
      {
        id: 'product',
        header: 'Product / variant',
        meta: { sortKey: 'product' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.product?.title ?? '—'}</p>
            <p className="text-muted-foreground truncate text-xs">
              {row.original.optionLabel ?? 'Single SKU'}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'quantity',
        header: 'On hand',
        meta: {
          sortKey: 'on_hand',
          headerClassName: 'text-right',
          cellClassName: 'text-right tabular-nums',
        },
        cell: ({ row }) => formatCount(row.original.quantity),
      },
      {
        accessorKey: 'reserved',
        header: 'Reserved',
        meta: {
          sortKey: 'reserved',
          headerClassName: 'text-right',
          cellClassName: 'text-right tabular-nums',
        },
        cell: ({ row }) =>
          row.original.reserved === 0 ? (
            <span className="text-muted-foreground">0</span>
          ) : (
            formatCount(row.original.reserved)
          ),
      },
      {
        accessorKey: 'available',
        header: 'Available',
        meta: {
          sortKey: 'available',
          headerClassName: 'text-right',
          cellClassName: 'text-right tabular-nums',
        },
        cell: ({ row }) => (
          <span
            className={cn(
              'font-medium',
              row.original.isOut && 'text-destructive',
              row.original.isLow && 'text-amber-600',
            )}
            title={
              row.original.isLow
                ? `At or below its threshold of ${row.original.lowStockThreshold}`
                : undefined
            }
          >
            {formatCount(row.original.available)}
            {row.original.isLow && ' ⚠'}
          </span>
        ),
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
                  aria-label={`Actions for ${row.original.sku}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => onAdjust(row.original)}>
                  <SlidersHorizontal className="size-4" />
                  Adjust stock
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRestock(row.original)}>
                  <PackagePlus className="size-4" />
                  Restock
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => void navigate(`/inventory/${row.original.variantId}`)}
                >
                  <History className="size-4" />
                  History
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAdjust, onRestock],
  )

  return (
    <DataTable
      columns={columns}
      data={rows}
      isLoading={isLoading}
      error={error}
      getRowId={(row) => row.variantId}
      onRowClick={(row) => void navigate(`/inventory/${row.variantId}`)}
      sorting={sorting}
      empty={empty}
    />
  )
}
