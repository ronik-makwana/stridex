import { cn } from '@/lib/utils'
import type { OrderPaymentStatus, OrderStatus, PaymentRecordStatus } from '@/types/api'

/**
 * Two badges, never one.
 *
 * Fulfilment and payment answer different questions — where is the parcel, and
 * did the money settle — and an operator filters on them separately. A single
 * combined pill would have to invent an order between "paid but not packed" and
 * "shipped but refunded", and there isn't one.
 */
const DOT = 'inline-block size-1.5 rounded-full bg-current'

const FULFILMENT: Record<OrderStatus, string> = {
  PENDING: 'text-amber-700 dark:text-amber-500',
  PROCESSING: 'text-blue-700 dark:text-blue-400',
  SHIPPED: 'text-violet-700 dark:text-violet-400',
  DELIVERED: 'text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'text-muted-foreground',
  REFUNDED: 'text-muted-foreground',
}

const PAYMENT: Record<OrderPaymentStatus, string> = {
  PENDING: 'text-amber-700 dark:text-amber-500',
  PAID: 'text-emerald-700 dark:text-emerald-400',
  PARTIALLY_REFUNDED: 'text-muted-foreground',
  REFUNDED: 'text-muted-foreground',
  FAILED: 'text-destructive',
}

const RECORD: Record<PaymentRecordStatus, string> = {
  PENDING: 'text-amber-700 dark:text-amber-500',
  AUTHORIZED: 'text-blue-700 dark:text-blue-400',
  CAPTURED: 'text-emerald-700 dark:text-emerald-400',
  FAILED: 'text-destructive',
  REFUNDED: 'text-muted-foreground',
  VOIDED: 'text-muted-foreground',
}

const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', FULFILMENT[status], className)}>
      <span className={DOT} aria-hidden />
      {title(status)}
    </span>
  )
}

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: OrderPaymentStatus
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', PAYMENT[status], className)}>
      <span className={DOT} aria-hidden />
      {title(status)}
    </span>
  )
}

export function PaymentRecordBadge({
  status,
  className,
}: {
  status: PaymentRecordStatus
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', RECORD[status], className)}>
      <span className={DOT} aria-hidden />
      {title(status)}
    </span>
  )
}

export const ORDER_STATUS_OPTIONS = (
  ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'] as OrderStatus[]
).map((value) => ({ value, label: title(value) }))

export const PAYMENT_STATUS_OPTIONS = (
  ['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED'] as OrderPaymentStatus[]
).map((value) => ({ value, label: title(value) }))

export const PAYMENT_RECORD_OPTIONS = (
  ['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'VOIDED'] as PaymentRecordStatus[]
).map((value) => ({ value, label: title(value) }))
