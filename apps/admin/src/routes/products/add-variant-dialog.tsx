import * as React from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useCreateVariant } from '@/features/products/mutations'
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
import { Spinner } from '@/components/ui/spinner'

/**
 * The single SKU. A product with no variant options — a care kit, a gift card,
 * anything that comes one way — still needs exactly one variant, because that
 * is what carries the price and the stock and what a cart line points at.
 *
 * Generate cannot serve this: there are no options to combine. Without a way in
 * here, such a product fails the publish checklist on "has at least one
 * variant" and can never go live.
 */
export function AddVariantDialog({
  productId,
  open,
  onOpenChange,
}: {
  productId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createVariant = useCreateVariant(productId)

  const [sku, setSku] = React.useState('')
  const [price, setPrice] = React.useState('')
  const [compareAtPrice, setCompareAtPrice] = React.useState('')
  const [quantity, setQuantity] = React.useState('0')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setSku('')
    setPrice('')
    setCompareAtPrice('')
    setQuantity('0')
    setError(null)
  }, [open])

  const submit = async () => {
    setError(null)
    try {
      await createVariant.mutateAsync({
        // Omitted rather than empty: the server derives it from the product,
        // which is the same rule generate follows.
        ...(sku.trim() ? { sku: sku.trim().toUpperCase() } : {}),
        price: price.trim(),
        compareAtPrice: compareAtPrice.trim() || null,
        quantity: Number(quantity) || 0,
        // No options declared, so no values to assign.
        optionValueIds: [],
      })
      toast.success('Variant added')
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.fields ? Object.values(err.fields)[0] : err.message)
          : 'Could not add the variant',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !createVariant.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add variant</DialogTitle>
          <DialogDescription>
            This product has no options, so it sells as one SKU. Price and stock live here, not on
            the product.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="new-variant-sku">SKU</Label>
            <Input
              id="new-variant-sku"
              value={sku}
              onChange={(event) => setSku(event.target.value.toUpperCase())}
              placeholder="Leave empty to derive it from the product"
              spellCheck={false}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-variant-price">Price</Label>
            <Input
              id="new-variant-price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              placeholder="8999.00"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-variant-compare">Compare at price</Label>
            <Input
              id="new-variant-compare"
              value={compareAtPrice}
              onChange={(event) => setCompareAtPrice(event.target.value)}
              inputMode="decimal"
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-variant-quantity">Opening stock</Label>
            <Input
              id="new-variant-quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="numeric"
            />
            <p className="text-muted-foreground text-xs">
              Written to the ledger as an adjustment, like every other stock move.
            </p>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createVariant.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={createVariant.isPending || !price.trim()}>
            {createVariant.isPending && <Spinner />}
            Add variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
