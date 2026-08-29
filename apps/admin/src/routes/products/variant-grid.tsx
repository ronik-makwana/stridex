import * as React from 'react'
import { MoreHorizontal, Pencil, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'
import { slugify } from '@/lib/slug'
import type { BulkVariantValues } from '@/features/products/schemas'
import type { Product, ProductVariant } from '@/types/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { VariantDrawer } from './variant-drawer'
import {
  AdjustStockDialog,
  type StockTarget,
} from '@/routes/inventory/adjust-stock-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The editable columns, in tab order. Stock is not among them: it is editable
 * when a variant is created and moves only through adjust or restock
 * afterwards, so that every change carries a reason and an author. A grid cell
 * cannot ask why.
 */
const COLUMNS = ['sku', 'price', 'compareAtPrice'] as const
type Column = (typeof COLUMNS)[number]

type Draft = Partial<Record<Column, string>>

const APPLY_TO_ALL: { value: Column; label: string }[] = [
  { value: 'price', label: 'Price' },
  { value: 'compareAtPrice', label: 'Compare at' },
]

const toStockTarget = (variant: ProductVariant): StockTarget => ({
  variantId: variant.id,
  sku: variant.sku,
  quantity: variant.stock.quantity,
  reserved: variant.stock.reserved,
})

/** Mirrors the API's default SKU rule — brand or title, then each option value. */
function autoSku(product: Product, variant: ProductVariant, taken: Set<string>): string {
  const base = [
    slugify(product.brand?.name ?? product.title),
    ...variant.options.map((option) => slugify(option.value)),
  ]
    .filter(Boolean)
    .join('-')
    .toUpperCase()
    .slice(0, 64)

  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, 64)
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`.slice(0, 64)
}

/**
 * A spreadsheet, not forty little forms. At the volumes this reaches — Colour ×
 * Size is nine rows before anyone tries hard — a modal per row is unusable, so
 * every cell is an input, Tab moves across, Enter moves down the column, and one
 * Save writes the lot in a single transaction.
 *
 * Edits are held locally until Save. Saving per keystroke would mean a ledger
 * row for every digit typed into a stock cell.
 */
export function VariantGrid({
  product,
  variants,
  onSave,
  onDelete,
  isSaving,
}: {
  product: Product
  variants: ProductVariant[]
  onSave: (values: BulkVariantValues) => Promise<unknown>
  onDelete: (variantId: string) => Promise<unknown>
  isSaving: boolean
}) {
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [editing, setEditing] = React.useState<ProductVariant | null>(null)
  const [adjusting, setAdjusting] = React.useState<StockTarget | null>(null)
  const [deleting, setDeleting] = React.useState<ProductVariant | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)
  const [applyColumn, setApplyColumn] = React.useState<Column>('price')
  const [applyValue, setApplyValue] = React.useState('')

  const gridRef = React.useRef<HTMLTableSectionElement>(null)

  /**
   * A save answers with the settled rows, so anything still in `drafts` would
   * be an edit the server has already accepted, shown as if it were pending.
   *
   * Keyed on what the rows contain rather than on the array's identity: the
   * product refetches for unrelated reasons — an image upload, a checklist
   * invalidation — and clearing half-typed prices on one of those would be
   * infuriating and impossible to attribute.
   */
  const fingerprint = variants.map((variant) => `${variant.id}:${variant.updatedAt}`).join('|')
  React.useEffect(() => {
    setDrafts({})
  }, [fingerprint])

  const optionColumns = product.variantOptions ?? []
  const dirtyCount = Object.values(drafts).filter((draft) => Object.keys(draft).length > 0).length

  const stored = (variant: ProductVariant, column: Column): string => {
    switch (column) {
      case 'sku':
        return variant.sku
      case 'price':
        return variant.price
      case 'compareAtPrice':
        return variant.compareAtPrice ?? ''
    }
  }

  const value = (variant: ProductVariant, column: Column): string =>
    drafts[variant.id]?.[column] ?? stored(variant, column)

  const write = (variant: ProductVariant, column: Column, next: string) =>
    setDrafts((current) => {
      const draft = { ...(current[variant.id] ?? {}) }
      // A cell edited back to what is stored is not an edit. Without this the
      // Save button stays lit after an undo and writes a no-op ledger row.
      if (next === stored(variant, column)) delete draft[column]
      else draft[column] = next
      return { ...current, [variant.id]: draft }
    })

  /** Enter moves down the same column — the way every spreadsheet behaves. */
  const onKeyDown = (event: React.KeyboardEvent, rowIndex: number, column: Column) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const next = gridRef.current?.querySelector<HTMLInputElement>(
      `[data-cell="${rowIndex + 1}:${column}"]`,
    )
    next?.focus()
    next?.select()
  }

  const applyToAll = () => {
    const next = applyValue.trim()
    if (!next) return
    setDrafts((current) => {
      const updated = { ...current }
      for (const variant of variants) {
        const draft = { ...(updated[variant.id] ?? {}) }
        if (next === stored(variant, applyColumn)) delete draft[applyColumn]
        else draft[applyColumn] = next
        updated[variant.id] = draft
      }
      return updated
    })
  }

  const generateSkus = () => {
    const taken = new Set<string>()
    setDrafts((current) => {
      const updated = { ...current }
      for (const variant of variants) {
        const sku = autoSku(product, variant, taken)
        taken.add(sku)
        const draft = { ...(updated[variant.id] ?? {}) }
        if (sku === variant.sku) delete draft.sku
        else draft.sku = sku
        updated[variant.id] = draft
      }
      return updated
    })
  }

  const save = async () => {
    const rows = variants.flatMap((variant) => {
      const draft = drafts[variant.id]
      if (!draft || Object.keys(draft).length === 0) return []
      return [
        {
          id: variant.id,
          ...(draft.sku !== undefined ? { sku: draft.sku.trim() } : {}),
          ...(draft.price !== undefined ? { price: draft.price.trim() } : {}),
          ...(draft.compareAtPrice !== undefined
            ? { compareAtPrice: draft.compareAtPrice.trim() || null }
            : {}),
        },
      ]
    })
    if (rows.length === 0) return

    try {
      await onSave({ variants: rows })
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? (error.fields ? Object.values(error.fields)[0] : error.message)
          : 'Could not save the grid',
      )
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await onDelete(deleting.id)
      toast.success(`${deleting.sku} deleted`)
      setDeleting(null)
    } catch (error) {
      // 422 is the designed outcome, not a failure: this variant has sold.
      if (error instanceof ApiError && error.status === 422) {
        setDeleteBlock(error.reason ?? error.message)
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this variant')
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-muted-foreground border-b text-xs uppercase">
            <tr>
              {optionColumns.map((option) => (
                <th key={option.id} className="px-3 py-2 text-left font-medium">
                  {option.name}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Compare at</th>
              <th className="px-3 py-2 text-right font-medium">On hand</th>
              <th className="px-3 py-2 text-right font-medium">Available</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>

          <tbody ref={gridRef}>
            {variants.map((variant, rowIndex) => {
              const draft = drafts[variant.id] ?? {}
              return (
                <tr key={variant.id} className="border-b last:border-b-0">
                  {optionColumns.map((option) => {
                    const assignment = variant.options.find(
                      (row) => row.variantOptionId === option.variantOptionId,
                    )
                    return (
                      <td key={option.id} className="px-3 py-1.5 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {assignment?.swatchHex && (
                            <span
                              className="border-border size-3.5 rounded-full border"
                              style={{ backgroundColor: assignment.swatchHex }}
                              aria-hidden
                            />
                          )}
                          {assignment?.value ?? '—'}
                        </span>
                      </td>
                    )
                  })}

                  <td className="px-1 py-1">
                    <Input
                      data-cell={`${rowIndex}:sku`}
                      value={value(variant, 'sku')}
                      onChange={(event) => write(variant, 'sku', event.target.value.toUpperCase())}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, 'sku')}
                      spellCheck={false}
                      aria-label={`SKU for row ${rowIndex + 1}`}
                      className={cn('h-8 font-mono text-xs', draft.sku !== undefined && 'border-ring')}
                    />
                  </td>

                  <td className="px-1 py-1">
                    <Input
                      data-cell={`${rowIndex}:price`}
                      value={value(variant, 'price')}
                      onChange={(event) => write(variant, 'price', event.target.value)}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, 'price')}
                      inputMode="decimal"
                      aria-label={`Price for row ${rowIndex + 1}`}
                      className={cn(
                        'h-8 text-right tabular-nums',
                        draft.price !== undefined && 'border-ring',
                      )}
                    />
                  </td>

                  <td className="px-1 py-1">
                    <Input
                      data-cell={`${rowIndex}:compareAtPrice`}
                      value={value(variant, 'compareAtPrice')}
                      onChange={(event) => write(variant, 'compareAtPrice', event.target.value)}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, 'compareAtPrice')}
                      inputMode="decimal"
                      placeholder="—"
                      aria-label={`Compare at price for row ${rowIndex + 1}`}
                      className={cn(
                        'h-8 text-right tabular-nums',
                        draft.compareAtPrice !== undefined && 'border-ring',
                      )}
                    />
                  </td>

                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {variant.stock.quantity}
                  </td>

                  <td
                    className={cn(
                      'px-3 py-1.5 text-right tabular-nums',
                      variant.stock.available === 0 && 'text-destructive font-medium',
                    )}
                    // Available is on hand minus what pending orders are
                    // holding. Read-only: it is a consequence, not a setting.
                    title={`${variant.stock.reserved} reserved`}
                  >
                    {variant.stock.available}
                  </td>

                  <td className="px-1 py-1 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${variant.sku}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <div className="px-2 py-1.5 text-xs">
                          <p className="font-mono">{variant.sku}</p>
                          <p className="text-muted-foreground mt-1">
                            {formatMoney(variant.price)}
                            {variant.compareAtPrice && (
                              <span className="ml-1 line-through">
                                {formatMoney(variant.compareAtPrice)}
                              </span>
                            )}
                          </p>
                          <div className="mt-1.5">
                            <StatusBadge status={variant.status} />
                          </div>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setAdjusting(toStockTarget(variant))}>
                          <SlidersHorizontal className="size-4" />
                          Adjust stock
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing(variant)}>
                          <Pencil className="size-4" />
                          Edit details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setDeleteBlock(null)
                            setDeleting(variant)
                          }}
                        >
                          <Trash2 className="size-4" />
                          Delete variant
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Select value={applyColumn} onValueChange={(next) => setApplyColumn(next as Column)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Column to fill">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLY_TO_ALL.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={applyValue}
          onChange={(event) => setApplyValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            applyToAll()
          }}
          placeholder="Value"
          aria-label="Value to apply to every row"
          className="h-8 w-28"
        />

        <Button variant="outline" size="sm" onClick={applyToAll} disabled={!applyValue.trim()}>
          Apply to all
        </Button>

        <Button variant="outline" size="sm" onClick={generateSkus}>
          <Wand2 className="size-4" />
          Auto-generate SKUs
        </Button>

        <span className="flex-1" />

        {dirtyCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {dirtyCount} {dirtyCount === 1 ? 'row' : 'rows'} edited
          </span>
        )}
        <Button size="sm" onClick={() => void save()} disabled={dirtyCount === 0 || isSaving}>
          {isSaving && <Spinner />}
          Save variants
        </Button>
      </div>

      <AdjustStockDialog target={adjusting} onOpenChange={(open) => !open && setAdjusting(null)} />

      <VariantDrawer
        product={product}
        variant={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onAdjust={(target) => {
          // Close the drawer first: two stacked dialogs trap focus in the one
          // underneath and Esc dismisses the wrong thing.
          setEditing(null)
          setAdjusting(toStockTarget(target))
        }}
      />

      {/*
        Two dialogs in one. Before the attempt it asks to confirm; after a 422
        it becomes the explanation. Retrying a blocked delete would fail
        identically, so there is no confirm button on that side.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleteBlock ? `Cannot delete ${deleting?.sku}` : `Delete ${deleting?.sku}?`}
        description={
          deleteBlock ?? 'Its stock and ledger go with it. Variants that have sold cannot be deleted.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
