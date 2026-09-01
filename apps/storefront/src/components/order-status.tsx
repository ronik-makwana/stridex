import { cn } from '@/lib/utils'
import type { OrderPaymentStatus, OrderStatus } from '@/types/api'

/**
 * Fulfilment and payment are two fields and two questions, and the badge shows
 * whichever one the customer needs to act on. A failed or refunded payment
 * outranks "Processing": where the parcel is matters less than whether the
 * money is theirs again (§11).
 */
const FULFILMENT: Record<OrderStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Confirmed', tone: 'text-emerald-700 dark:text-emerald-400' },
  PROCESSING: { label: 'Processing', tone: 'text-foreground' },
  SHIPPED: { label: 'Shipped', tone: 'text-foreground' },
  DELIVERED: { label: 'Delivered', tone: 'text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', tone: 'text-muted-foreground' },
  REFUNDED: { label: 'Refunded', tone: 'text-muted-foreground' },
}

const PAYMENT_OVERRIDE: Partial<Record<OrderPaymentStatus, { label: string; tone: string }>> = {
  FAILED: { label: 'Payment failed', tone: 'text-destructive' },
  REFUNDED: { label: 'Refunded', tone: 'text-muted-foreground' },
  PARTIALLY_REFUNDED: { label: 'Partly refunded', tone: 'text-muted-foreground' },
  PENDING: { label: 'Payment pending', tone: 'text-amber-700 dark:text-amber-500' },
}

export function OrderStatusBadge({
  status,
  paymentStatus,
  className,
}: {
  status: OrderStatus
  paymentStatus: OrderPaymentStatus
  className?: string
}) {
  const shown = PAYMENT_OVERRIDE[paymentStatus] ?? FULFILMENT[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', shown.tone, className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {shown.label}
    </span>
  )
}

/** The steps a parcel walks, for the detail page's timeline. */
export const FULFILMENT_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'PENDING', label: 'Confirmed' },
  { status: 'PROCESSING', label: 'Processing' },
  { status: 'SHIPPED', label: 'Shipped' },
  { status: 'DELIVERED', label: 'Delivered' },
]
