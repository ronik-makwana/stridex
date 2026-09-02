import type { RefundReason, RefundRequestStatus, RefundStatus } from '@/types/api'
import { Badge } from '@/components/ui/badge'

/**
 * One vocabulary for returns and refunds, shared by the queue, the detail
 * screen and the order page.
 *
 * Kept in a single file because these three enums are read side by side on
 * every one of those screens, and a status that reads "Received" in the queue
 * and "Parcel back" on the order is two words for one fact.
 */

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  CHANGED_MIND: 'Changed their mind',
  WRONG_SIZE: 'Wrong size',
  DAMAGED: 'Arrived damaged',
  NOT_AS_DESCRIBED: 'Not as described',
  WRONG_ITEM: 'Wrong item sent',
  LATE_DELIVERY: 'Arrived late',
  OTHER: 'Other',
}

/**
 * The label says what is true; the variant says whether anybody has to do
 * something about it. REQUESTED is the only one that is waiting on *us*, so it
 * is the only one that carries the solid badge.
 */
const REQUEST_BADGE: Record<RefundRequestStatus, { label: string; variant: 'default' | 'secondary' | 'muted' | 'outline' | 'success' | 'destructive' }> = {
  REQUESTED: { label: 'Awaiting decision', variant: 'default' },
  APPROVED: { label: 'Awaiting parcel', variant: 'outline' },
  RECEIVED: { label: 'Parcel received', variant: 'secondary' },
  COMPLETED: { label: 'Refunded', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'muted' },
}

export function ReturnStatusBadge({ status }: { status: RefundRequestStatus }) {
  const shown = REQUEST_BADGE[status]
  return <Badge variant={shown.variant}>{shown.label}</Badge>
}

const REFUND_BADGE: Record<RefundStatus, { label: string; variant: 'muted' | 'outline' | 'success' | 'destructive' }> = {
  // Two states of the same thing to us, one thing to whoever is waiting: the
  // money has not arrived yet.
  PENDING: { label: 'Not sent yet', variant: 'muted' },
  PROCESSING: { label: 'With the provider', variant: 'outline' },
  SUCCEEDED: { label: 'Refunded', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
}

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const shown = REFUND_BADGE[status]
  return <Badge variant={shown.variant}>{shown.label}</Badge>
}
