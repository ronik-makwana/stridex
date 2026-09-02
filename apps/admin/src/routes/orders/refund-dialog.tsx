import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useRefundOrder } from '@/features/returns/mutations'
import { formatMoney } from '@/lib/format'
import type { Order, RefundReason } from '@/types/api'
import { REFUND_REASON_LABELS } from '@/components/refund-labels'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

const REASONS = Object.keys(REFUND_REASON_LABELS) as RefundReason[]

/**
 * A refund an operator decided on, against no return.
 *
 * Money only: it moves no stock and closes nothing. That is the difference
 * between this and receiving a return, and the reason the copy says so out
 * loud — a goodwill ₹200 that quietly marked a pair as returned would be a
 * warehouse looking for a parcel nobody posted.
 *
 * The amount is capped here on `refundableAmount` and capped again by the
 * server, which is the figure that counts: it can move between this render and
 * the click, and only the transaction sees every in-flight refund.
 */
export function RefundDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const refund = useRefundOrder()
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState<RefundReason>('OTHER')
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setAmount('')
    setReason('OTHER')
    setNote('')
  }, [open])

  const ceiling = Number(order.refundableAmount)
  const entered = Number(amount)
  const overCeiling = Number.isFinite(entered) && entered > ceiling
  const valid = /^\d{1,10}(\.\d{1,2})?$/.test(amount) && entered > 0 && !overCeiling

  const submit = async () => {
    try {
      await refund.mutateAsync({ orderId: order.id, amount, reason, note: note.trim() })
      toast.success(`${formatMoney(amount)} is on its way back`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not issue that refund')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {formatMoney(order.refundableAmount)} of {formatMoney(order.totalAmount)} can still go
            back. Nothing is restocked and no return is opened.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="refund-amount">Amount</Label>
            <Input
              id="refund-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              aria-invalid={amount.length > 0 && !valid}
              onChange={(event) => setAmount(event.target.value)}
            />
            {overCeiling && (
              <p className="text-destructive text-xs">
                At most {formatMoney(order.refundableAmount)} is left on this order.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-reason">Reason</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as RefundReason)}>
              <SelectTrigger id="refund-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {REFUND_REASON_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-note">Why (internal)</Label>
            <Textarea
              id="refund-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Courier lost the parcel for four days — goodwill"
            />
            {/* Required by the schema: a refund nobody explained is one nobody
                can audit six months later. */}
          </div>

          <Alert>
            <AlertTriangle />
            <AlertDescription>
              The customer keeps what they have. If goods are coming back, use the return instead —
              that is what puts stock on the shelf.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={refund.isPending || !valid || note.trim().length === 0}>
            {refund.isPending && <Spinner />}
            Refund {valid ? formatMoney(amount) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
