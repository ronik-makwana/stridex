import * as React from 'react'
import { Link, useParams } from 'react-router'
import { SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useReturn } from '@/features/returns/queries'
import { useApproveReturn, useRejectReturn } from '@/features/returns/mutations'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import type { ReturnRequest } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import {
  REFUND_REASON_LABELS,
  RefundStatusBadge,
  ReturnStatusBadge,
} from '@/components/refund-labels'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ReceiveDialog } from './receive-dialog'

/**
 * One return, and the three decisions on it.
 *
 * The staging is deliberate and visible: approving commits to nothing (the
 * parcel is still in the customer's hall), and receiving is the only click that
 * moves stock and sends money. So approve and reject sit in the header where
 * decisions live, and Mark received gets its own form — it needs to know what
 * actually turned up, which is not always what was asked for.
 */
export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: request, isPending, error } = useReturn(id)
  const [rejecting, setRejecting] = React.useState(false)
  const [receiving, setReceiving] = React.useState(false)
  const approve = useApproveReturn()

  if (isPending) return <DetailSkeleton />

  if (error || !request) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That return no longer exists' : 'Could not load this return'}
        description={missing ? undefined : (error as Error | null)?.message}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/returns">Back to returns</Link>
          </Button>
        }
      />
    )
  }

  const outstanding = request.items.reduce((sum, item) => sum + item.outstandingQuantity, 0)
  const canDecide = request.status === 'REQUESTED'
  const canReceive =
    (request.status === 'APPROVED' || request.status === 'RECEIVED') && outstanding > 0

  const approveRequest = async () => {
    try {
      await approve.mutateAsync({ id: request.id, note: null })
      toast.success('Approved — the customer can post it back')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not approve this return')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/returns"
        backLabel="Back to returns"
        title={request.order.orderNumber}
        badge={<ReturnStatusBadge status={request.status} />}
        description={`${request.type === 'CANCELLATION' ? 'Cancellation' : 'Return'} raised ${formatDate(request.createdAt)} · ${REFUND_REASON_LABELS[request.reason]}`}
        actions={
          <>
            {canDecide && (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  Reject
                </Button>
                <Button onClick={approveRequest} disabled={approve.isPending}>
                  {approve.isPending && <Spinner />}
                  Approve
                </Button>
              </>
            )}
            {canReceive && <Button onClick={() => setReceiving(true)}>Mark received</Button>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <section className="bg-card rounded-lg border">
            <header className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-medium">Coming back</h2>
              <span className="text-muted-foreground text-sm tabular-nums">
                {formatMoney(request.estimatedAmount)}
              </span>
            </header>
            <ul className="divide-y">
              {request.items.map((item) => {
                const received = item.restockedQuantity + item.unsellableQuantity
                return (
                  <li key={item.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{item.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {item.options.map((option) => option.value).join(' / ')} · {item.sku}
                      </p>
                    </div>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      ×{item.quantity}
                    </span>
                    {/*
                      What has physically turned up, per line. Two numbers
                      because "it came back" and "it can be sold again" are
                      different facts, and the ledger records both.
                    */}
                    {received > 0 && (
                      <span className="text-muted-foreground text-xs">
                        {item.restockedQuantity > 0 && `${item.restockedQuantity} restocked`}
                        {item.restockedQuantity > 0 && item.unsellableQuantity > 0 && ' · '}
                        {item.unsellableQuantity > 0 && `${item.unsellableQuantity} written off`}
                      </span>
                    )}
                    {item.outstandingQuantity > 0 && received > 0 && (
                      <Badge variant="outline">{item.outstandingQuantity} outstanding</Badge>
                    )}
                    <span className="w-20 text-right text-sm tabular-nums">
                      {formatMoney(item.amount)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          {request.comment && (
            <section className="bg-card rounded-lg border p-5">
              <h2 className="text-sm font-medium">What they said</h2>
              <p className="text-muted-foreground mt-2 text-sm whitespace-pre-line">
                {request.comment}
              </p>
            </section>
          )}

          <section className="bg-card rounded-lg border">
            <header className="border-b px-5 py-3">
              <h2 className="text-sm font-medium">Refunds</h2>
            </header>
            {request.refunds.length === 0 ? (
              <p className="text-muted-foreground px-5 py-4 text-sm">
                Nothing has been refunded yet. Money goes out when the parcel is received.
              </p>
            ) : (
              <ul className="divide-y">
                {request.refunds.map((refund) => (
                  <li key={refund.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="text-sm tabular-nums">{formatMoney(refund.amount)}</span>
                    <RefundStatusBadge status={refund.status} />
                    <span className="text-muted-foreground flex-1 text-xs">
                      {formatDateTime(refund.createdAt)}
                      {refund.providerRefundId && ` · ${refund.providerRefundId}`}
                    </span>
                    {/*
                      A refund the provider declined is the one thing on this
                      screen that needs somebody, so it says why rather than
                      hiding behind a badge.
                    */}
                    {refund.failureReason && (
                      <span className="text-destructive w-full text-xs">{refund.failureReason}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <Panel title="Customer">
            <p>{request.customer.name ?? '—'}</p>
            <p className="text-muted-foreground">{request.customer.email}</p>
            <Link
              to={`/orders/${request.order.id}`}
              className="mt-2 inline-block underline underline-offset-4"
            >
              {request.order.orderNumber}
            </Link>
            <p className="text-muted-foreground">
              {formatMoney(request.order.totalAmount)} · delivered{' '}
              {formatDate(request.order.deliveredAt)}
            </p>
          </Panel>

          {request.decidedAt && (
            <Panel title={request.status === 'REJECTED' ? 'Rejected' : 'Decision'}>
              <p className="text-muted-foreground">
                {request.decidedBy?.name ?? 'Somebody'} · {formatDateTime(request.decidedAt)}
              </p>
              {request.decisionNote && <p className="mt-1">{request.decisionNote}</p>}
            </Panel>
          )}

          {request.receivedAt && (
            <Panel title="Parcel received">
              <p className="text-muted-foreground">{formatDateTime(request.receivedAt)}</p>
            </Panel>
          )}
        </aside>
      </div>

      <RejectDialog request={request} open={rejecting} onOpenChange={setRejecting} />
      <ReceiveDialog request={request} open={receiving} onOpenChange={setReceiving} />
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-lg border p-5 text-sm">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Rejecting needs a sentence, and the schema enforces it — the customer is
 * shown this. "No" with nothing after it is the message that generates the
 * phone call this queue exists to avoid.
 */
function RejectDialog({
  request,
  open,
  onOpenChange,
}: {
  request: ReturnRequest
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [note, setNote] = React.useState('')
  const reject = useRejectReturn()

  React.useEffect(() => {
    if (open) setNote('')
  }, [open])

  const submit = async () => {
    try {
      await reject.mutateAsync({ id: request.id, note: note.trim() })
      toast.success('Rejected — the customer has been told why')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reject this return')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this return</DialogTitle>
          <DialogDescription>
            The customer is shown what you write here. Nothing is refunded and no stock moves.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-note">Why</Label>
          <Textarea
            id="reject-note"
            rows={4}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Outside the 7-day window — it was delivered on 12 August."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reject.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={reject.isPending || note.trim().length === 0}>
            {reject.isPending && <Spinner />}
            Reject return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-56" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}
