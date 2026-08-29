import type * as React from 'react'
import { Link } from 'react-router'
import { History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import type { InventoryTransaction, ListMeta } from '@/types/api'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'

const TYPE_VARIANT = {
  RESTOCK: 'success',
  RETURN: 'success',
  RELEASE: 'muted',
  SALE: 'outline',
  RESERVATION: 'outline',
  ADJUSTMENT: 'muted',
} as const satisfies Record<InventoryTransaction['type'], React.ComponentProps<typeof Badge>['variant']>

const timestamp = (value: string) =>
  `${formatDate(value)} ${new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`

/**
 * Append-only, so there is no kebab column at all — nothing here can be edited
 * or deleted, and offering a menu that only ever says "view" invites someone to
 * look for a way to fix a row rather than write a correcting one.
 *
 * A mistaken entry is corrected by another entry. That is what makes the
 * running total reconstructable from the rows.
 */
export function StockLedger({
  transactions,
  meta,
  isLoading,
  isFetching,
  onPageChange,
  showSku = true,
  emptyDescription = 'Stock moves show up here the moment anything is adjusted, restocked or sold.',
}: {
  transactions: InventoryTransaction[]
  meta: ListMeta | undefined
  isLoading?: boolean
  isFetching?: boolean
  onPageChange: (page: number) => void
  /** Off on a variant's own history, where every row is the same SKU. */
  showSku?: boolean
  emptyDescription?: string
}) {
  if (isLoading) {
    return (
      <div className="bg-card space-y-3 rounded-lg border p-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-card rounded-lg border">
        <EmptyState icon={History} title="Nothing recorded yet" description={emptyDescription} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-xs uppercase">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Date</th>
              {showSku && <th className="px-4 py-2.5 text-left font-medium">SKU</th>}
              <th className="px-4 py-2.5 text-left font-medium">Type</th>
              <th className="px-4 py-2.5 text-right font-medium">Qty</th>
              <th className="px-4 py-2.5 text-left font-medium">Reason</th>
              <th className="px-4 py-2.5 text-left font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                  {timestamp(row.createdAt)}
                </td>

                {showSku && (
                  <td className="px-4 py-2.5">
                    {row.variantId ? (
                      <Link
                        to={`/inventory/${row.variantId}`}
                        className="hover:text-foreground font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {row.sku}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground font-mono text-xs">—</span>
                    )}
                    {row.product && (
                      <p className="text-muted-foreground truncate text-xs">{row.product.title}</p>
                    )}
                  </td>
                )}

                <td className="px-4 py-2.5">
                  <Badge variant={TYPE_VARIANT[row.type]}>{row.type}</Badge>
                </td>

                <td
                  className={cn(
                    'px-4 py-2.5 text-right font-medium tabular-nums',
                    row.quantity < 0 ? 'text-destructive' : 'text-emerald-600',
                  )}
                >
                  {/* Signed, because the column has to add up to the number on
                      the inventory row. */}
                  {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                </td>

                <td className="px-4 py-2.5">
                  <span>{row.reason ?? '—'}</span>
                  {row.note && (
                    <p className="text-muted-foreground truncate text-xs">{row.note}</p>
                  )}
                </td>

                <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                  {row.createdBy?.name ?? row.createdBy?.email ?? 'system'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DataTablePagination meta={meta} onPageChange={onPageChange} isFetching={isFetching} />
    </div>
  )
}
