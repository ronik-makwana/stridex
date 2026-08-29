import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, PackagePlus, SearchX, SlidersHorizontal } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { formatCount, formatRelative } from '@/lib/format'
import { useListParams } from '@/hooks/use-list-params'
import { useInventoryRow, useVariantLedger } from '@/features/inventory/queries'
import { useSetThreshold } from '@/features/inventory/mutations'
import type { InventoryRow } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { AdjustStockDialog, type StockTarget } from './adjust-stock-dialog'
import { RestockDialog } from './restock-dialog'
import { StockLedger } from './stock-ledger'

export default function InventoryVariantPage() {
  const { variantId } = useParams<{ variantId: string }>()
  const navigate = useNavigate()
  const { data: row, isPending, error } = useInventoryRow(variantId)

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That variant no longer exists' : 'Could not load this variant'}
        description={missing ? undefined : error.message}
        action={
          <Button variant="outline" size="sm" onClick={() => void navigate('/inventory')}>
            <ArrowLeft className="size-4" />
            Back to inventory
          </Button>
        }
      />
    )
  }

  return <VariantInventory key={row.variantId} row={row} />
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint?: string
  tone?: 'danger' | 'warning'
}) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'danger' && 'text-destructive',
          tone === 'warning' && 'text-amber-600',
        )}
      >
        {formatCount(value)}
      </p>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
    </div>
  )
}

function VariantInventory({ row }: { row: InventoryRow }) {
  const params = useListParams({ defaultSort: '', defaultLimit: 25 })
  const { data: ledger, isPending, isFetching } = useVariantLedger(row.variantId, {
    page: params.page,
    limit: params.limit,
  })

  const setThreshold = useSetThreshold()
  const [threshold, setThresholdValue] = React.useState(String(row.lowStockThreshold))
  const [adjusting, setAdjusting] = React.useState<StockTarget | null>(null)
  const [restocking, setRestocking] = React.useState<StockTarget | null>(null)

  React.useEffect(() => {
    setThresholdValue(String(row.lowStockThreshold))
  }, [row.lowStockThreshold])

  const target: StockTarget = {
    variantId: row.variantId,
    sku: row.sku,
    quantity: row.quantity,
    reserved: row.reserved,
  }

  const parsedThreshold = Number(threshold)
  const thresholdChanged =
    Number.isInteger(parsedThreshold) &&
    parsedThreshold >= 0 &&
    parsedThreshold !== row.lowStockThreshold

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/inventory"
        backLabel="Back to inventory"
        title={row.sku}
        actions={
          <>
            <StatusBadge status={row.status} />
            <Button variant="outline" onClick={() => setRestocking(target)}>
              <PackagePlus className="size-4" />
              Restock
            </Button>
            <Button onClick={() => setAdjusting(target)}>
              <SlidersHorizontal className="size-4" />
              Adjust stock
            </Button>
          </>
        }
      />

      <p className="text-muted-foreground text-sm">
        {row.product ? (
          <>
            <Link
              to={`/products/${row.productId}`}
              className="hover:text-foreground underline-offset-2 hover:underline"
            >
              {row.product.title}
            </Link>
            {row.optionLabel && ` · ${row.optionLabel}`}
          </>
        ) : (
          'Product missing'
        )}
        {' · '}updated {formatRelative(row.updatedAt)}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="On hand" value={row.quantity} hint="Physically in the warehouse" />
        <StatTile
          label="Reserved"
          value={row.reserved}
          hint="Held by orders that have not shipped"
        />
        <StatTile
          label="Available"
          value={row.available}
          hint="What can still be sold"
          tone={row.isOut ? 'danger' : row.isLow ? 'warning' : undefined}
        />
      </div>

      <section className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-5">
        <div className="space-y-2">
          <Label htmlFor="variant-threshold">Low-stock threshold</Label>
          <Input
            id="variant-threshold"
            value={threshold}
            onChange={(event) => setThresholdValue(event.target.value)}
            inputMode="numeric"
            className="h-9 w-28 tabular-nums"
          />
        </div>
        <Button
          variant="outline"
          disabled={!thresholdChanged || setThreshold.isPending}
          onClick={() =>
            void setThreshold.mutateAsync({
              variantId: row.variantId,
              threshold: parsedThreshold,
            })
          }
        >
          {setThreshold.isPending && <Spinner />}
          Save threshold
        </Button>
        {/* Configuration, not stock: no lock and no ledger row, because nothing
            about the physical count has changed. */}
        <p className="text-muted-foreground flex-1 text-xs">
          When available drops to this or below, the SKU shows in Low stock. Changing it moves no
          units, so it writes nothing to the ledger.
        </p>
      </section>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">History</h2>
        <StockLedger
          transactions={ledger?.data ?? []}
          meta={ledger?.meta}
          isLoading={isPending}
          isFetching={isFetching}
          onPageChange={params.setPage}
          showSku={false}
          emptyDescription="Nothing has moved for this SKU yet."
        />
      </div>

      <AdjustStockDialog target={adjusting} onOpenChange={(open) => !open && setAdjusting(null)} />
      <RestockDialog target={restocking} onOpenChange={(open) => !open && setRestocking(null)} />
    </div>
  )
}
