import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
import { Link } from 'react-router'
import { Package } from 'lucide-react'
import { useOrders } from '@/features/orders/queries'
import { OrderStatusBadge } from '@/components/order-status'
import { formatDate, formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { OrderCard } from '@/types/api'

/**
 * A list of cards, not a table. Nobody sorts their own order history, and
 * nobody scans it by column — they are looking for one order they already
 * remember (§3.11).
 */
export default function OrdersPage() {
  const [page, setPage] = React.useState(1)
  const { data, isPending } = useOrders(page)

  usePageMeta({ title: 'Orders' })

  const orders = data?.data ?? []
  const totalPages = data?.meta.totalPages ?? 1

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl">Orders</h1>

      {orders.length === 0 ? (
        <div className="mt-8 flex flex-col items-center border border-dashed px-6 py-16 text-center">
          <Package className="text-muted-foreground/40 size-8" />
          <p className="mt-4 text-sm">No orders yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Anything you buy shows up here, with what you paid and where it went.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button asChild variant="accent" size="sm">
              <Link to="/categories/men">Shop men</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/categories/women">Shop women</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/categories/kids">Shop kids</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderRow order={order} />
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-muted-foreground tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OrderRow({ order }: { order: OrderCard }) {
  return (
    <Link
      to={`/account/orders/${order.orderNumber}`}
      className="hover:border-foreground/40 flex items-center gap-4 border p-4 transition-colors"
    >
      <div className="flex -space-x-3">
        {order.thumbnails.map((image, index) => (
          <div
            key={index}
            className="bg-secondary ring-background relative h-12 w-10 overflow-hidden ring-2"
          >
            {image && (
              <img
                src={image.url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            )}
          </div>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="tabular-nums">{order.orderNumber}</span>
          <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} />
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {order.placedAt ? formatDate(order.placedAt) : formatDate(order.createdAt)} ·{' '}
          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
          {/*
            An open return is the one thing about an order in this list that is
            waiting on somebody. It rides on the card payload, so saying it here
            costs no second request.
          */}
          {order.activeRequest?.type === 'RETURN' && ' · Return in progress'}
        </p>
      </div>

      <span className="shrink-0 text-sm tabular-nums">{formatMoney(order.totalAmount)}</span>
    </Link>
  )
}
