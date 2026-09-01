import * as React from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useOrder } from '@/features/orders/queries'
import { FULFILMENT_STEPS, OrderStatusBadge } from '@/components/order-status'
import { formatDate, formatMoney } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import NotFoundPage from '../not-found'

/**
 * One order. Every row on it renders the `order_items` snapshot — if the
 * product has since been renamed or repriced, this page does not follow. That
 * is the whole reason those columns exist (§19).
 *
 * `?confirming=1` is how the checkout hands over: the order may not exist for
 * another second or two while the webhook lands, so the page polls and says so
 * rather than showing a 404 to somebody who has just paid (§10, §12).
 */
export default function OrderDetailPage() {
  const { orderNumber } = useParams()
  const [params] = useSearchParams()
  const confirming = params.get('confirming') === '1'
  const { data: order, isPending, error } = useOrder(orderNumber, { poll: confirming })

  React.useEffect(() => {
    document.title = orderNumber ? `${orderNumber} · StrideX` : 'Order · StrideX'
  }, [orderNumber])

  if (isPending) return <OrderSkeleton />

  if (error) {
    // Still waiting on the webhook: an honest intermediate state, not a fake
    // success and not a 404.
    if (confirming && error instanceof ApiError && error.status === 404) return <Confirming />
    if (error instanceof ApiError && error.status === 404) return <NotFoundPage />
  }
  if (!order) return <NotFoundPage />

  const reached = new Set(order.timeline.map((entry) => entry.status))
  const cancelled = order.status === 'CANCELLED' || order.status === 'REFUNDED'

  return (
    <div>
      <Link
        to="/account/orders"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl tabular-nums sm:text-2xl">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Placed {formatDate(order.placedAt ?? order.createdAt)}
      </p>

      {/* The timeline reads order_status_history and shows customer-facing
          statuses only — internal notes and who changed them stay in admin. */}
      {!cancelled && (
        <ol className="mt-8 flex items-center">
          {FULFILMENT_STEPS.map((step, index) => {
            const done = reached.has(step.status)
            return (
              <li key={step.status} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      done ? 'bg-foreground' : 'border-muted-foreground/40 border bg-transparent',
                    )}
                  />
                  <span className={cn('text-xs', done ? 'text-foreground' : 'text-muted-foreground')}>
                    {step.label}
                  </span>
                </div>
                {index < FULFILMENT_STEPS.length - 1 && (
                  <span
                    className={cn(
                      'mx-2 -mt-5 h-px flex-1',
                      done ? 'bg-foreground' : 'bg-border',
                    )}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="divide-y border-y">
          {order.items.map((item) => (
            <div key={item.id} className="flex gap-4 py-4">
              <div className="bg-secondary relative h-20 w-16 shrink-0 overflow-hidden">
                {item.image && (
                  <img
                    src={item.image.url}
                    alt={item.image.altText ?? item.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                {/* Linked only while the product still exists. The line itself
                    is the snapshot and renders either way. */}
                {item.slug ? (
                  <Link to={`/products/${item.slug}`} className="hover:underline">
                    {item.title}
                  </Link>
                ) : (
                  <span>{item.title}</span>
                )}
                <p className="text-muted-foreground mt-1 text-xs">
                  {item.options.map((option) => option.value).join(' / ')} · SKU {item.sku}
                </p>
                <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                  {formatMoney(item.unitPrice)} × {item.quantity}
                </p>
              </div>
              <span className="shrink-0 text-sm tabular-nums">{formatMoney(item.totalPrice)}</span>
            </div>
          ))}
        </div>

        <aside className="space-y-6 text-sm">
          {order.shippingAddress && (
            <section>
              <h2 className="text-xs tracking-[0.14em] uppercase">Delivering to</h2>
              <div className="text-muted-foreground mt-2 leading-relaxed">
                <p className="text-foreground">{order.shippingAddress.fullName}</p>
                <p>{order.shippingAddress.addressLine1}</p>
                {order.shippingAddress.addressLine2 && <p>{order.shippingAddress.addressLine2}</p>}
                <p>
                  {order.shippingAddress.city} {order.shippingAddress.postalCode}
                </p>
                <p className="tabular-nums">{order.shippingAddress.phone}</p>
              </div>
            </section>
          )}

          {order.payment && (
            <section>
              <h2 className="text-xs tracking-[0.14em] uppercase">Payment</h2>
              <p className="text-muted-foreground mt-2">
                {order.payment.method ?? order.payment.provider} · {formatMoney(order.payment.amount)}
              </p>
              <p className="text-muted-foreground">Paid {formatDate(order.payment.paidAt)}</p>
            </section>
          )}

          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Summary</h2>
            <dl className="mt-2 space-y-1.5">
              <Row label="Subtotal" value={order.subtotal} />
              {Number(order.discountAmount) > 0 && (
                <Row label="Discount" value={`-${order.discountAmount}`} />
              )}
              <Row label="Shipping" value={order.shippingAmount} />
              <div className="flex items-baseline justify-between border-t pt-2">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(order.totalAmount)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  )
}

function Confirming() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <Loader2 className="text-muted-foreground size-7 animate-spin" />
      <h1 className="mt-5 text-lg">Confirming your payment</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm">
        Your bank is confirming the payment. This page updates itself — there is no need to pay
        again, and nothing has gone wrong.
      </p>
    </div>
  )
}

function OrderSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
