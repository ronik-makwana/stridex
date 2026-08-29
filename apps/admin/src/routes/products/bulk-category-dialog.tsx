import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { CategorySelect } from '@/components/category-select'

/**
 * "Change category" on the bulk bar. Its own dialog rather than a submenu
 * because the tree is four levels deep and a dropdown inside a dropdown is
 * where keyboard navigation stops working.
 */
export function BulkCategoryDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  onConfirm: (categoryId: string | null) => Promise<void>
}) {
  const [categoryId, setCategoryId] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  // Reopening should not offer whatever was picked last time.
  React.useEffect(() => {
    if (open) setCategoryId(null)
  }, [open])

  const submit = async () => {
    setPending(true)
    try {
      await onConfirm(categoryId)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change category</DialogTitle>
          <DialogDescription>
            {count === 1 ? 'One product' : `${count} products`} will move. Nothing else about them
            changes — attributes and variants are picked per product, not inherited from the tree.
          </DialogDescription>
        </DialogHeader>

        <CategorySelect
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          noneLabel="Remove from category"
          disabled={pending}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            {pending && <Spinner />}
            Move {count === 1 ? 'product' : 'products'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
