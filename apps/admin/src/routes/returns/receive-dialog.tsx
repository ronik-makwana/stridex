import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useReceiveReturn } from '@/features/returns/mutations'
import { formatMoney } from '@/lib/format'
import type { ReturnRequest } from '@/types/api'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

/**
 * The parcel is here — the one click in the admin that moves stock and sends
 * money in the same transaction.
 *
 * It asks what **actually** turned up rather than assuming the request was
 * honoured in full, because it often is not: two of three pairs today, or three
 * pairs of which one is unwearable. Both numbers are per line and both are
 * capped at what is still outstanding, so a second receipt on a half-arrived
 * parcel can only ever cover the remainder.
 *
 * Restocked and written-off are separate because they are different facts.
 * A worn pair is still refunded — that is what written-off means — but it must
 * not become sellable stock, so it is written back in and written off in two
 * ledger entries rather than quietly skipped.
 */
export function ReceiveDialog({
  request,
  open,
  onOpenChange,
}: {
  request: ReturnRequest
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const outstanding = request.items.filter((item) => item.outstandingQuantity > 0)
  const receive = useReceiveReturn()
  const [lines, setLines] = React.useState<Record<string, { restock: number; unsellable: number }>>({})
  const [note, setNote] = React.useState('')

  // Opens on the common case: everything outstanding came back and can be sold
  // again. Anything else is a correction to that, not a form to fill from empty.
  React.useEffect(() => {
    if (!open) return
    setNote('')
    setLines(
      Object.fromEntries(
        outstanding.map((item) => [item.id, { restock: item.outstandingQuantity, unsellable: 0 }]),
      ),
    )
    // `outstanding` is derived from `request` and recreated each render; keying
    // the reset on the request itself is what makes this run once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request])

  const set = (id: string, key: 'restock' | 'unsellable', value: number, max: number) =>
    setLines((current) => {
      const line = current[id] ?? { restock: 0, unsellable: 0 }
      const other = key === 'restock' ? line.unsellable : line.restock
      // Clamped against the *other* number as well: the two together can never
      // exceed what is outstanding, which the database also enforces.
      const clamped = Math.max(0, Math.min(value, max - other))
      return { ...current, [id]: { ...line, [key]: clamped } }
    })

  const items = Object.entries(lines)
    .map(([requestItemId, line]) => ({
      requestItemId,
      restockQuantity: line.restock,
      unsellableQuantity: line.unsellable,
    }))
    .filter((line) => line.restockQuantity + line.unsellableQuantity > 0)

  const partial = outstanding.some((item) => {
    const line = lines[item.id]
    return !line || line.restock + line.unsellable < item.outstandingQuantity
  })

  const submit = async () => {
    try {
      const updated = await receive.mutateAsync({
        id: request.id,
        items,
        note: note.trim() || null,
      })
      const refunded = updated.refunds.at(-1)
      toast.success(
        refunded
          ? `Received — ${formatMoney(refunded.amount)} is on its way back`
          : 'Received — stock is back',
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not receive this return')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>What arrived?</DialogTitle>
          <DialogDescription>
            Stock goes back and the refund is sent as soon as you save this.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-3 text-xs">
            <span>Item</span>
            <span>Restock</span>
            <span>Write off</span>
          </div>
          {outstanding.map((item) => {
            const line = lines[item.id] ?? { restock: 0, unsellable: 0 }
            return (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{item.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.outstandingQuantity} outstanding · {item.sku}
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={item.outstandingQuantity}
                  value={line.restock}
                  aria-label={`Units of ${item.title} back in stock`}
                  onChange={(event) =>
                    set(item.id, 'restock', Number(event.target.value), item.outstandingQuantity)
                  }
                />
                <Input
                  type="number"
                  min={0}
                  max={item.outstandingQuantity}
                  value={line.unsellable}
                  aria-label={`Units of ${item.title} written off`}
                  onChange={(event) =>
                    set(item.id, 'unsellable', Number(event.target.value), item.outstandingQuantity)
                  }
                />
              </div>
            )
          })}

          {/*
            Said before saving, because a half-received return stays open and
            somebody has to know that is what they are choosing rather than
            discovering it in the queue tomorrow.
          */}
          {partial && (
            <Alert>
              <AlertTriangle />
              <AlertDescription>
                Only part of this return is being received. The rest stays outstanding, and the
                customer is refunded for what arrived.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="receive-note">Note (optional)</Label>
            <Textarea
              id="receive-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Box was open, shoes fine"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={receive.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={receive.isPending || items.length === 0}>
            {receive.isPending && <Spinner />}
            Receive and refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
