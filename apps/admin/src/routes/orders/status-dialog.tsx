import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useUpdateOrderStatus } from '@/features/orders/mutations'
import type { Order, OrderStatus } from '@/types/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

const LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
}

/**
 * The only mutation on an order, and the whole reason it is a modal rather than
 * an inline select: a status change is a claim about the physical world, and
 * the note is what makes it explicable three weeks later.
 *
 * The options come from the API, so this dialog cannot offer a transition the
 * service would refuse. Backwards moves are offered *and* warned about — an
 * admin who cannot correct a mis-click will correct it in the database, where
 * nothing writes history.
 */
export function StatusDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const updateStatus = useUpdateOrderStatus()
  const [target, setTarget] = React.useState<OrderStatus | null>(null)
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setTarget(null)
      setNote('')
    }
  }, [open])

  const chosen = order.allowedTransitions.find((option) => option.to === target)
  const terminal = target === 'CANCELLED' || target === 'REFUNDED'

  const submit = async () => {
    if (!target) return
    try {
      await updateStatus.mutateAsync({ id: order.id, status: target, note: note.trim() || null })
      toast.success(`${order.orderNumber} is now ${LABEL[target].toLowerCase()}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not update this order')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update {order.orderNumber}</DialogTitle>
          <DialogDescription>
            Currently {LABEL[order.status].toLowerCase()}. The change is recorded against your
            name.
          </DialogDescription>
        </DialogHeader>

        {order.allowedTransitions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {LABEL[order.status]} is where this order ends — there is nothing further to set.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Move to</Label>
              <div className="flex flex-wrap gap-2">
                {order.allowedTransitions.map((option) => (
                  <button
                    key={option.to}
                    type="button"
                    onClick={() => setTarget(option.to)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      target === option.to
                        ? 'border-foreground bg-secondary'
                        : 'hover:border-foreground/40',
                    )}
                  >
                    {LABEL[option.to]}
                  </button>
                ))}
              </div>
            </div>

            {chosen?.backwards && (
              <Alert>
                <AlertTriangle />
                <AlertDescription>
                  This moves the order backwards. Fine for correcting a mistake — the previous
                  status stays in the history either way.
                </AlertDescription>
              </Alert>
            )}

            {terminal && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>
                  {LABEL[target!]} is final and cannot be undone. Stock is not returned
                  automatically — adjust it on the inventory screen, with a reason.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional. 'Customer called, address wrong' is the difference between a timeline and a list of timestamps."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!target || updateStatus.isPending}>
            {updateStatus.isPending && <Spinner />}
            Update status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
