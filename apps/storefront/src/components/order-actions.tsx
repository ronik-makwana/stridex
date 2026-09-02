import { useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, RotateCcw, X } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { formatDate, formatMoneyExact } from '@/lib/format'
import {
  useCancelOrder,
  useRequestReturn,
  useWithdrawReturn,
} from '@/features/orders/queries'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { QuantityStepper } from '@/components/quantity-stepper'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { Order, RefundReason } from '@/types/api'

/**
 * What a customer may do to their own order, and what has happened since they
 * asked.
 *
 * Every rule behind these controls lives on the server — `cancellable`,
 * `returnable`, `returnWindowEndsAt` and each line's `returnableQuantity` all
 * arrive decided. Nothing here recomputes a deadline or a quantity, because a
 * second copy of a rule is a second answer waiting to disagree with the first.
 */

/** The reasons, in the customer's words rather than the enum's. */
const REFUND_REASONS: { value: RefundReason; label: string }[] = [
  { value: 'WRONG_SIZE', label: "It doesn't fit" },
  { value: 'CHANGED_MIND', label: 'Changed my mind' },
  { value: 'DAMAGED', label: 'Arrived damaged' },
  { value: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { value: 'WRONG_ITEM', label: 'Wrong item sent' },
  { value: 'LATE_DELIVERY', label: 'Arrived too late' },
  { value: 'OTHER', label: 'Something else' },
]

/** Cancelling is never about fit — nothing has arrived to try on. */
const CANCEL_REASONS = REFUND_REASONS.filter(
  (reason) => !['WRONG_SIZE', 'DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM'].includes(reason.value),
)

const textareaClass =
  'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-ring aria-invalid:border-destructive w-full resize-y rounded-md border bg-transparent px-3.5 py-2.5 text-base outline-none focus-visible:outline-2 focus-visible:-outline-offset-1'

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback

// ─── the action row ──────────────────────────────────────────────────────────

export function OrderActions({ order }: { order: Order }) {
  const [cancelling, setCancelling] = useState(false)
  const [returning, setReturning] = useState(false)

  const windowClosed =
    order.status === 'DELIVERED' && !order.returnable && !order.activeRequest

  if (!order.cancellable && !order.returnable && !windowClosed) return null

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      {order.cancellable && (
        <>
          <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>
            <X /> Cancel order
          </Button>
          <p className="text-muted-foreground text-xs">
            Free while it is still being prepared — the full amount goes back.
          </p>
        </>
      )}

      {order.returnable && (
        <>
          <Button variant="outline" size="sm" onClick={() => setReturning(true)}>
            <RotateCcw /> Return items
          </Button>
          {order.returnWindowEndsAt && (
            <p className="text-muted-foreground text-xs">
              Free returns until {formatDate(order.returnWindowEndsAt)}
            </p>
          )}
        </>
      )}

      {/*
        The window having closed is worth saying. An order page that simply
        stops offering a return leaves the customer looking for a button that
        was there last week and wondering whether they missed it.
      */}
      {windowClosed && (
        <p className="text-muted-foreground text-xs">
          {order.returnWindowEndsAt
            ? `The return window closed on ${formatDate(order.returnWindowEndsAt)}.`
            : 'This order can no longer be returned.'}{' '}
          Get in touch if something is wrong with it.
        </p>
      )}

      <CancelDialog order={order} open={cancelling} onOpenChange={setCancelling} />
      <ReturnDialog order={order} open={returning} onOpenChange={setReturning} />
    </div>
  )
}

// ─── cancelling ──────────────────────────────────────────────────────────────

function CancelDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState<RefundReason>('CHANGED_MIND')
  const [comment, setComment] = useState('')
  const cancel = useCancelOrder(order.orderNumber)

  const needsComment = reason === 'OTHER' && comment.trim().length === 0

  const submit = async () => {
    try {
      await cancel.mutateAsync({ reason, comment: comment.trim() || null })
      onOpenChange(false)
      toast.success('Order cancelled — your refund is on its way')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not cancel that order'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cancel this order"
        description={`${formatMoneyExact(order.totalAmount)} goes back to how you paid, including delivery.`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Why are you cancelling?</Label>
            <Select
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as RefundReason)}
            >
              {CANCEL_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-comment">
              Anything else? {reason !== 'OTHER' && <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <textarea
              id="cancel-comment"
              rows={3}
              maxLength={500}
              className={textareaClass}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>

          {/*
            Said before the click, not after it. Cancelling is the one action
            here with no way back, and a customer who learns that from a toast
            has learned it too late.
          */}
          <Alert>
            <AlertCircle />
            <AlertDescription>
              This cannot be undone. You will need to order again if you change your mind, and the
              price may have moved.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
              Keep my order
            </Button>
            <Button onClick={submit} disabled={cancel.isPending || needsComment}>
              {cancel.isPending && <Spinner />}
              {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── returning ───────────────────────────────────────────────────────────────

function ReturnDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const returnable = order.items.filter((item) => item.returnableQuantity > 0)
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<RefundReason>('WRONG_SIZE')
  const [comment, setComment] = useState('')
  const request = useRequestReturn(order.orderNumber)

  const items = Object.entries(chosen)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }))

  const needsComment = reason === 'OTHER' && comment.trim().length === 0

  const toggle = (id: string, max: number) =>
    setChosen((current) => ({ ...current, [id]: current[id] ? 0 : Math.min(1, max) }))

  const submit = async () => {
    try {
      await request.mutateAsync({ items, reason, comment: comment.trim() || null })
      onOpenChange(false)
      setChosen({})
      toast.success('Return requested — we will email you once it is approved')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not request that return'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Return items"
        description="Choose what is coming back. We will confirm before you post anything."
      >
        <div className="space-y-5">
          <ul className="divide-y border-y">
            {returnable.map((item) => {
              const quantity = chosen[item.id] ?? 0
              const picked = quantity > 0
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    id={`return-${item.id}`}
                    className="accent-foreground size-4"
                    checked={picked}
                    onChange={() => toggle(item.id, item.returnableQuantity)}
                  />
                  <label htmlFor={`return-${item.id}`} className="min-w-0 flex-1 text-sm">
                    <span className={cn('block truncate', !picked && 'text-muted-foreground')}>
                      {item.title}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {item.options.map((option) => option.value).join(' / ')}
                    </span>
                  </label>
                  {/*
                    Only when there is a choice to make. A stepper offering
                    1 of 1 is a control that cannot do anything.
                  */}
                  {picked && item.returnableQuantity > 1 && (
                    <QuantityStepper
                      quantity={quantity}
                      max={item.returnableQuantity}
                      onChange={(next) => setChosen((current) => ({ ...current, [item.id]: next }))}
                    />
                  )}
                </li>
              )
            })}
          </ul>

          <div className="space-y-1.5">
            <Label htmlFor="return-reason">Why are you sending it back?</Label>
            <Select
              id="return-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as RefundReason)}
            >
              {REFUND_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-comment">
              Tell us more {reason !== 'OTHER' && <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <textarea
              id="return-comment"
              rows={3}
              maxLength={500}
              className={textareaClass}
              placeholder="Anything that helps us sort it out faster"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>

          {/*
            The delivery charge is not coming back, and saying so here costs one
            line. Not saying it costs a support email from somebody counting the
            refund against what they paid.
          */}
          <p className="text-muted-foreground text-xs">
            We refund what you paid for the items. Delivery is not refunded on a return.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={request.isPending}>
              Not now
            </Button>
            <Button onClick={submit} disabled={request.isPending || items.length === 0 || needsComment}>
              {request.isPending && <Spinner />}
              {request.isPending ? 'Sending…' : 'Request return'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── what is already in motion ───────────────────────────────────────────────

/** Where a request has got to, in the customer's terms rather than the enum's. */
const REQUEST_PROGRESS: Record<string, { title: string; body: string }> = {
  REQUESTED: {
    title: 'Return requested',
    body: 'We are looking at it. You will get an email when it is approved, with where to send it.',
  },
  APPROVED: {
    title: 'Return approved',
    body: 'Post it back to us. Your refund is issued once it arrives.',
  },
  RECEIVED: {
    title: 'We have your return',
    body: 'The refund is on its way to your original payment method.',
  },
}

export function ActiveRequestNotice({ order }: { order: Order }) {
  const request = order.activeRequest
  const withdraw = useWithdrawReturn(order.orderNumber)

  // A cancellation shows itself in the status and the timeline. Announcing it
  // again in a panel would be the same news twice.
  if (!request || request.type === 'CANCELLATION') return null

  const progress = REQUEST_PROGRESS[request.status]
  if (!progress) return null

  const withdrawRequest = async () => {
    try {
      await withdraw.mutateAsync(request.id)
      toast.success('Return withdrawn')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not withdraw that return'))
    }
  }

  return (
    <div className="bg-secondary/50 mt-6 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">{progress.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{progress.body}</p>
          <p className="text-muted-foreground mt-2 text-xs">
            Requested {formatDate(request.requestedAt)} · {formatMoneyExact(request.amount)}
          </p>
        </div>
        {/*
          Only while it is still a question. Once it is approved there may be a
          courier booked, and un-asking from a phone would leave the warehouse
          expecting a parcel that is not coming.
        */}
        {request.status === 'REQUESTED' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={withdrawRequest}
            disabled={withdraw.isPending}
          >
            {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The money, in the sidebar under what was paid. */
export function RefundSummary({ order }: { order: Order }) {
  if (order.refunds.length === 0) return null

  return (
    <section>
      <h2 className="text-xs tracking-[0.14em] uppercase">Refunds</h2>
      <ul className="mt-2 space-y-2">
        {order.refunds.map((refund) => (
          <li key={refund.id}>
            <div className="flex items-baseline justify-between">
              <span className="tabular-nums">{formatMoneyExact(refund.amount)}</span>
              <span className="text-muted-foreground text-xs">
                {refund.settledAt ? formatDate(refund.settledAt) : 'On its way'}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {refund.settledAt
                ? 'Refunded to your original payment method'
                : 'Sent to your bank — usually 5–7 working days'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
