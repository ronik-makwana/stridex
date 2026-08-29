import * as React from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useDuplicateProduct } from '@/features/products/mutations'
import type { Product } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
 * A copy, not a link. Images are copied inside object storage rather than
 * shared, so deleting one from the copy cannot break the original — and stock
 * is off by default, because a duplicate that arrives already in stock is stock
 * nobody counted.
 */
export function DuplicateProductDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const duplicate = useDuplicateProduct()

  const [title, setTitle] = React.useState('')
  const [includeMedia, setIncludeMedia] = React.useState(true)
  const [includeVariants, setIncludeVariants] = React.useState(true)
  const [includeInventory, setIncludeInventory] = React.useState(false)

  React.useEffect(() => {
    if (open) setTitle(`${product.title} copy`)
  }, [open, product.title])

  const submit = async () => {
    try {
      const created = await duplicate.mutateAsync({
        id: product.id,
        values: { title: title.trim(), includeMedia, includeVariants, includeInventory },
      })
      toast.success(`${created.title} created as a draft`)
      onOpenChange(false)
      void navigate(`/products/${created.id}`)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not duplicate this product')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !duplicate.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate product</DialogTitle>
          <DialogDescription>
            The copy is always a draft. Attributes and options come across either way.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="duplicate-title">Title</Label>
            <Input
              id="duplicate-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2.5">
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={includeMedia}
                onCheckedChange={(checked) => setIncludeMedia(checked === true)}
              />
              Copy images
            </label>

            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={includeVariants}
                onCheckedChange={(checked) => {
                  setIncludeVariants(checked === true)
                  // Stock lives on variants. Keeping it ticked with no variants
                  // to hold it would be a setting with nowhere to land.
                  if (checked !== true) setIncludeInventory(false)
                }}
              />
              Copy variants
              <span className="text-muted-foreground text-xs">SKUs get a -COPY suffix</span>
            </label>

            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={includeInventory}
                disabled={!includeVariants}
                onCheckedChange={(checked) => setIncludeInventory(checked === true)}
                className="mt-0.5"
              />
              <span>
                Copy stock
                <span className="text-muted-foreground block text-xs">
                  Off by default. Copied units still get a ledger entry saying where they came from.
                </span>
              </span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={duplicate.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={duplicate.isPending || !title.trim()}>
            {duplicate.isPending && <Spinner />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
