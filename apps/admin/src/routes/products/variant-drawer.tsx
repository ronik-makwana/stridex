import * as React from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useUpdateVariant } from '@/features/products/mutations'
import type { Product, ProductVariant } from '@/types/api'
import { STATUS_OPTIONS } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

type Draft = {
  sku: string
  barcode: string
  price: string
  compareAtPrice: string
  status: ProductVariant['status']
  mediaId: string | null
  quantity: string
  lowStockThreshold: string
}

const toDraft = (variant: ProductVariant): Draft => ({
  sku: variant.sku,
  barcode: variant.barcode ?? '',
  price: variant.price,
  compareAtPrice: variant.compareAtPrice ?? '',
  status: variant.status,
  mediaId: variant.mediaId,
  quantity: String(variant.stock.quantity),
  lowStockThreshold: String(variant.stock.lowStockThreshold),
})

/**
 * The fields the grid has no column for: barcode, status, the low-stock
 * threshold, and which of the product's images this variant leads with.
 *
 * They are per-variant and rarely edited, so putting them in the grid would
 * cost four columns that are blank on most rows — while leaving them out
 * entirely would mean a barcode that can only be set through the API.
 */
export function VariantDrawer({
  product,
  variant,
  onOpenChange,
}: {
  product: Product
  variant: ProductVariant | null
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateVariant(product.id)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDraft(variant ? toDraft(variant) : null)
    setError(null)
  }, [variant])

  const write = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [field]: value } : current))

  const submit = async () => {
    if (!variant || !draft) return
    setError(null)
    try {
      await update.mutateAsync({
        variantId: variant.id,
        values: {
          sku: draft.sku.trim(),
          barcode: draft.barcode.trim() || null,
          price: draft.price.trim(),
          compareAtPrice: draft.compareAtPrice.trim() || null,
          status: draft.status,
          mediaId: draft.mediaId,
          quantity: Number(draft.quantity) || 0,
          lowStockThreshold: Number(draft.lowStockThreshold) || 0,
        },
      })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.fields ? Object.values(err.fields)[0] : err.message)
          : 'Could not save this variant',
      )
      toast.error('Could not save this variant')
    }
  }

  const media = product.media ?? []

  return (
    <Dialog open={Boolean(variant)} onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{variant?.sku}</DialogTitle>
          <DialogDescription>
            {variant?.options.map((option) => option.value).join(' / ') || 'Single variant'}
          </DialogDescription>
        </DialogHeader>

        {draft && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="variant-sku">SKU</Label>
                <Input
                  id="variant-sku"
                  value={draft.sku}
                  onChange={(event) => write('sku', event.target.value.toUpperCase())}
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="variant-barcode">Barcode</Label>
                <Input
                  id="variant-barcode"
                  value={draft.barcode}
                  onChange={(event) => write('barcode', event.target.value)}
                  placeholder="Optional"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="variant-price">Price</Label>
                <Input
                  id="variant-price"
                  value={draft.price}
                  onChange={(event) => write('price', event.target.value)}
                  inputMode="decimal"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="variant-compare">Compare at price</Label>
                <Input
                  id="variant-compare"
                  value={draft.compareAtPrice}
                  onChange={(event) => write('compareAtPrice', event.target.value)}
                  inputMode="decimal"
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="variant-quantity">On hand</Label>
                <Input
                  id="variant-quantity"
                  value={draft.quantity}
                  onChange={(event) => write('quantity', event.target.value)}
                  inputMode="numeric"
                />
                <p className="text-muted-foreground text-xs">
                  {variant?.stock.reserved ?? 0} reserved by pending orders.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="variant-threshold">Low stock at</Label>
                <Input
                  id="variant-threshold"
                  value={draft.lowStockThreshold}
                  onChange={(event) => write('lowStockThreshold', event.target.value)}
                  inputMode="numeric"
                />
                <p className="text-muted-foreground text-xs">
                  What the low-stock filter counts this variant against.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="variant-status">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) => write('status', value as ProductVariant['status'])}
              >
                <SelectTrigger id="variant-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Archiving hides one variant from the storefront without touching the others.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Image</Label>
              {media.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  This product has no images yet. Add some above and they show up here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {/* Null means "use the product cover" — an explicit choice
                      rather than a variant that silently has no image. */}
                  <button
                    type="button"
                    onClick={() => write('mediaId', null)}
                    aria-pressed={draft.mediaId === null}
                    className={cn(
                      'text-muted-foreground flex size-14 items-center justify-center rounded-md border border-dashed text-[10px]',
                      draft.mediaId === null && 'border-primary text-foreground border-solid',
                    )}
                  >
                    Cover
                  </button>
                  {media.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => write('mediaId', item.id)}
                      aria-pressed={draft.mediaId === item.id}
                      className={cn(
                        'size-14 overflow-hidden rounded-md border',
                        draft.mediaId === item.id && 'border-primary ring-primary/30 ring-2',
                      )}
                    >
                      <img
                        src={item.url}
                        alt={item.altText ?? ''}
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={update.isPending}>
            {update.isPending && <Spinner />}
            Save variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
