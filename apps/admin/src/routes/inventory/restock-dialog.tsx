import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useRestock } from '@/features/inventory/mutations'
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
import type { StockTarget } from './adjust-stock-dialog'

/**
 * Its own dialog rather than a reason on Adjust, because a delivery is always
 * additive and always positive — no mode to choose, no way to type a negative
 * by mistake, and the ledger row lands as RESTOCK rather than an adjustment
 * nobody can tell apart from a recount later.
 */
export function RestockDialog({
  target,
  onOpenChange,
}: {
  target: StockTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const restock = useRestock()

  const [quantity, setQuantity] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!target) return
    setQuantity('')
    setReference('')
    setNote('')
    setError(null)
  }, [target])

  const onHand = target?.quantity ?? 0
  const parsed = Number(quantity)
  const isValid = quantity.trim() !== '' && Number.isInteger(parsed) && parsed > 0

  const submit = async () => {
    if (!target || !isValid) return
    setError(null)
    try {
      await restock.mutateAsync({
        variantId: target.variantId,
        values: {
          quantity: parsed,
          reference: reference.trim() || null,
          note: note.trim() || null,
        },
      })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.reason ?? err.message) : 'Could not record the restock.',
      )
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !restock.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restock</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{target?.sku}</span> · currently {onHand} on hand
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="restock-quantity">Units received</Label>
            <Input
              id="restock-quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="numeric"
              placeholder="40"
              autoFocus
              className="tabular-nums"
            />
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {isValid ? `New on hand: ${onHand + parsed}` : ' '}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="restock-reference">Reference</Label>
            <Input
              id="restock-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="PO-889"
              maxLength={120}
            />
            <p className="text-muted-foreground text-xs">
              A purchase order or delivery note. It leads the ledger entry.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="restock-note">Note</Label>
            <Input
              id="restock-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
              maxLength={500}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restock.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!isValid || restock.isPending}>
            {restock.isPending && <Spinner />}
            Record restock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
