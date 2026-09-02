import * as React from 'react'
import { Link, useParams } from 'react-router'
import { SearchX } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useOrder } from '@/features/orders/queries'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { OrderStatusBadge, PaymentRecordBadge, PaymentStatusBadge } from '@/components/order-status-badge'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDialog } from './status-dialog'

/**
 * One order, rendered from its snapshots.
 *
 * Nothing on this page joins to the live product. The title, SKU, options and
 * price are what was charged, and if the product has since been renamed or
 * repriced this page does not follow — which is the entire reason those columns
 * exist on `order_items` (§19).
 */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: order, isPending, error } = useOrder(id)
  const [updating, setUpdating] = React.useState(false)

  if (isPending) return <DetailSkeleton />

  if (error || !order) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That order no longer exists' : 'Could not load this order'}
        description={missing ? undefined : (error as Error | null)?.message}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/orders">Back to orders</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/orders"
        backLabel="Back to orders"
        title={order.orderNumber}
        actions={
          <>
            <PaymentStatusBadge status={order.paymentStatus} />
            <OrderStatusBadge status={order.status} />
            <Button onClick={() => setUpdating(true)} disabled={order.allowedTransitions.length === 0}>
              Update status
            </Button>
          </>
        }
      />

      <p className="text-muted-foreground text-sm">
        Placed {formatDate(order.placedAt ?? order.createdAt)}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <section className="bg-card rounded-lg border">
            <h2 className="border-b px-5 py-3 text-sm font-semibold">Items</h2>
            <div className="divide-y">
              {order.items.map((item) => (
                <div key={item.id} className="flex gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{item.productTitle}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {item.variantOptions.map((option) => `${option.name} ${option.value}`).join(' · ')}
                      {item.variantOptions.length > 0 && ' · '}SKU {item.sku}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                      {formatMoney(item.unitPrice)} × {item.quantity}
                      {Number(item.discountAmount) > 0 && ` · −${formatMoney(item.discountAmount)}`}
                      {item.discountCode && ` (${item.discountCode})`}
                    </p>
                  </div>
                  {/* Charged, with the pre-discount figure beside it. */}
                  <span className="text-sm tabular-nums">
                    {Number(item.discountAmount) > 0 ? (
                      <>
                        {formatMoney(item.discountedTotal)}
                        <span className="text-muted-foreground ml-1.5 line-through">
                          {formatMoney(item.totalPrice)}
                        </span>
                      </>
                    ) : (
                      formatMoney(item.totalPrice)
                    )}
                  </span>
                </div>
              ))}
            </div>

            <dl className="space-y-1.5 border-t px-5 py-4 text-sm">
              {/*
                The same arithmetic, in the same order, as the checkout summary
                and the customer's own order page. Support reads this while the
                customer reads theirs, and two layouts of one order is how a
                call about a refund becomes a call about a discrepancy.

                Subtotal is the lines as charged — each line's own discount
                already off, and shown against that line above.
              */}
              <Row label="Subtotal" value={order.goodsTotal} />

              {/* No line to show it against, so it gets its own row, by code. */}
              {order.discounts
                .filter((discount) => discount.kind === 'ORDER' && Number(discount.amount) > 0)
                .map((discount) => (
                  <Row key={discount.code} label={discount.code} value={`-${discount.amount}`} />
                ))}

              <Row label="Shipping" value={order.shippingAmount} />

              {/* Under the rate it came off. */}
              {order.discounts
                .filter((discount) => discount.kind === 'SHIPPING' && Number(discount.amount) > 0)
                .map((discount) => (
                  <Row key={discount.code} label={discount.code} value={`-${discount.amount}`} />
                ))}
              <div className="flex items-baseline justify-between border-t pt-2 font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(order.totalAmount)}</dd>
              </div>
              {Number(order.discountAmount) > 0 && (
                <div className="text-muted-foreground flex items-baseline justify-between">
                  <dt>Total savings</dt>
                  <dd className="tabular-nums">{formatMoney(order.discountAmount)}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="bg-card rounded-lg border">
            <h2 className="border-b px-5 py-3 text-sm font-semibold">Payments</h2>
            {order.payments.length === 0 ? (
              <p className="text-muted-foreground px-5 py-4 text-sm">No payment attempts.</p>
            ) : (
              <div className="divide-y">
                {order.payments.map((payment) => (
                  <Link
                    key={payment.id}
                    to={`/payments/${payment.id}`}
                    className="hover:bg-secondary/50 flex items-center justify-between gap-4 px-5 py-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{payment.providerPaymentId}</p>
                      <p className="text-muted-foreground text-xs">
                        {payment.provider}
                        {payment.method ? ` · ${payment.method}` : ''} ·{' '}
                        {formatDateTime(payment.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm tabular-nums">{formatMoney(payment.amount)}</span>
                      <PaymentRecordBadge status={payment.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="bg-card rounded-lg border">
            <h2 className="border-b px-5 py-3 text-sm font-semibold">History</h2>
            <ol className="divide-y">
              {order.history.map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <p className="text-sm">
                    {entry.fromStatus ? `${title(entry.fromStatus)} → ` : ''}
                    {title(entry.toStatus)}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatDateTime(entry.createdAt)} ·{' '}
                    {/* Rows the webhook wrote have no author, and 'system' is
                        the honest label rather than a blank. */}
                    {entry.changedBy?.name ?? 'system'}
                  </p>
                  {entry.note && <p className="mt-1 text-sm">{entry.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-card space-y-1 rounded-lg border p-5">
            <h2 className="text-sm font-semibold">Customer</h2>
            {order.customer ? (
              <>
                <p className="mt-2 text-sm">{order.customer.name ?? '—'}</p>
                <p className="text-muted-foreground text-sm">{order.customer.email}</p>
              </>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">Guest</p>
            )}
          </section>

          {order.shippingAddress && (
            <AddressCard title="Shipping address" address={order.shippingAddress} />
          )}
          {order.billingAddress && (
            <AddressCard title="Billing address" address={order.billingAddress} />
          )}
        </aside>
      </div>

      <StatusDialog order={order} open={updating} onOpenChange={setUpdating} />
    </div>
  )
}

const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase()

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  )
}

function AddressCard({
  title: heading,
  address,
}: {
  title: string
  address: {
    fullName: string
    phone: string
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string
    postalCode: string
  }
}) {
  return (
    <section className="bg-card rounded-lg border p-5">
      <h2 className="text-sm font-semibold">{heading}</h2>
      <div className="text-muted-foreground mt-2 text-sm leading-relaxed">
        <p className="text-foreground">{address.fullName}</p>
        <p>{address.addressLine1}</p>
        {address.addressLine2 && <p>{address.addressLine2}</p>}
        <p>
          {address.city}, {address.state} {address.postalCode}
        </p>
        <p className="tabular-nums">{address.phone}</p>
      </div>
    </section>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  )
}
