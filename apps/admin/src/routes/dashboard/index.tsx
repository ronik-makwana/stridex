import * as React from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import {
  useAttention,
  useLowStock,
  useRecentOrders,
  useSales,
  useSummary,
  useTopProducts,
} from '@/features/dashboard/queries'
import { formatCount, formatDate, formatMoney } from '@/lib/format'
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/order-status-badge'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The first screen anybody opens.
 *
 * Every card fetches on its own, and every card has its own skeleton — the
 * summary answers in milliseconds and the sales series does not, and one
 * spinner over the whole page makes the fast half wait for the slow one.
 */
const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60_000).toISOString().slice(0, 10)

export default function DashboardPage() {
  const [days, setDays] = React.useState('30')
  const range = React.useMemo(() => ({ from: daysAgo(Number(days)) }), [days])

  const summary = useSummary(range)
  const sales = useSales(range)
  const orders = useRecentOrders()
  const lowStock = useLowStock()
  const top = useTopProducts(range)
  const attention = useAttention()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        actions={
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* Needs attention sits above the numbers: it is the only part of this
          page that asks somebody to do something today. */}
      {attention.data && attention.data.length > 0 && (
        <section className="bg-card rounded-lg border">
          <h2 className="flex items-center gap-2 border-b px-5 py-3 text-sm font-semibold">
            <AlertTriangle className="size-4" />
            Needs attention
          </h2>
          <ul className="divide-y">
            {attention.data.map((line) => (
              <li key={line.key}>
                {/* Each line links into the pre-filtered list that shows exactly
                    those rows — a count nobody can act on is decoration. */}
                <Link
                  to={line.to}
                  className="hover:bg-secondary/50 block px-5 py-3 text-sm transition-colors"
                >
                  {line.label} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.isPending ? (
          [0, 1, 2, 3].map((card) => <Skeleton key={card} className="h-28 w-full rounded-lg" />)
        ) : summary.data ? (
          <>
            <StatCard
              label="Revenue"
              value={formatMoney(summary.data.revenue.value)}
              change={summary.data.revenue.changePercent}
              hint={`${formatCount(summary.data.revenue.orderCount)} paid`}
            />
            <StatCard
              label="Orders"
              value={formatCount(summary.data.orders.value)}
              change={summary.data.orders.changePercent}
            />
            <StatCard
              label="Products"
              value={formatCount(summary.data.products.value)}
              hint={`${formatCount(summary.data.products.drafts)} drafts`}
            />
            <StatCard
              label="Customers"
              value={formatCount(summary.data.customers.value)}
              change={summary.data.customers.changePercent}
              hint="new in window"
            />
          </>
        ) : null}
      </div>

      <section className="bg-card rounded-lg border p-5">
        <h2 className="text-sm font-semibold">Sales</h2>
        {sales.isPending ? (
          <Skeleton className="mt-4 h-40 w-full" />
        ) : (
          <SalesChart points={sales.data ?? []} />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-card rounded-lg border">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-sm font-semibold">Recent orders</h2>
            <Link to="/orders" className="text-muted-foreground text-xs underline underline-offset-4">
              View all
            </Link>
          </div>
          {orders.isPending ? (
            <Skeleton className="m-5 h-32" />
          ) : orders.data && orders.data.length > 0 ? (
            <ul className="divide-y">
              {orders.data.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="hover:bg-secondary/50 flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="tabular-nums">{order.orderNumber}</p>
                      <p className="text-muted-foreground truncate text-xs">{order.customer}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <PaymentStatusBadge status={order.paymentStatus} />
                      <OrderStatusBadge status={order.status} />
                      <span className="tabular-nums">{formatMoney(order.totalAmount)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-5 py-6 text-sm">No orders yet.</p>
          )}
        </section>

        <section className="bg-card rounded-lg border">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-sm font-semibold">Low stock</h2>
            <Link
              to="/inventory/low-stock"
              className="text-muted-foreground text-xs underline underline-offset-4"
            >
              View all
            </Link>
          </div>
          {lowStock.isPending ? (
            <Skeleton className="m-5 h-32" />
          ) : lowStock.data && lowStock.data.length > 0 ? (
            <ul className="divide-y">
              {lowStock.data.map((row) => (
                <li key={row.variantId}>
                  <Link
                    to={`/inventory/${row.variantId}`}
                    className="hover:bg-secondary/50 flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{row.title}</p>
                      <p className="text-muted-foreground text-xs">{row.sku}</p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 tabular-nums',
                        row.available === 0 ? 'text-destructive' : 'text-amber-700 dark:text-amber-500',
                      )}
                    >
                      {row.available}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-5 py-6 text-sm">Nothing running low.</p>
          )}
        </section>
      </div>

      <section className="bg-card rounded-lg border">
        <h2 className="border-b px-5 py-3 text-sm font-semibold">Top products</h2>
        {top.isPending ? (
          <Skeleton className="m-5 h-24" />
        ) : top.data && top.data.length > 0 ? (
          <ul className="divide-y">
            {top.data.map((product) => (
              <li key={product.sku} className="flex items-center justify-between px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{product.title}</p>
                  <p className="text-muted-foreground text-xs">{product.sku}</p>
                </div>
                <div className="text-right">
                  <p className="tabular-nums">{product.units} sold</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatMoney(product.revenue)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-5 py-6 text-sm">Nothing sold in this window.</p>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  change,
  hint,
}: {
  label: string
  value: string
  change?: number | null
  hint?: string
}) {
  return (
    <section className="bg-card rounded-lg border p-5">
      <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">{label}</p>
      <p className="mt-2 text-2xl tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
        {/* Null rather than ∞ when there is no baseline — see the service. */}
        {typeof change === 'number' && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5',
              change >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive',
            )}
          >
            {change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(change)}%
          </span>
        )}
        {hint}
      </p>
    </section>
  )
}

/**
 * A bar per bucket, drawn from the server's series. No charting library: this
 * is one number per day against a maximum, and a dependency for that is a
 * dependency to keep up to date forever.
 */
function SalesChart({ points }: { points: { at: string; revenue: string; orders: number }[] }) {
  if (points.length === 0) {
    return <p className="text-muted-foreground mt-4 text-sm">No sales in this window.</p>
  }

  const max = Math.max(...points.map((point) => Number(point.revenue)), 1)
  const total = points.reduce((sum, point) => sum + Number(point.revenue), 0)

  return (
    <div className="mt-4">
      <p className="text-muted-foreground text-xs">
        {formatMoney(total.toFixed(2))} across {points.length} days
      </p>
      <div className="mt-3 flex h-40 items-end gap-[2px]">
        {points.map((point) => {
          const height = (Number(point.revenue) / max) * 100
          return (
            <div
              key={point.at}
              className="bg-foreground/80 hover:bg-foreground min-h-[2px] flex-1 rounded-sm transition-colors"
              style={{ height: `${Math.max(height, 1)}%` }}
              title={`${formatDate(point.at)} · ${formatMoney(point.revenue)} · ${point.orders} orders`}
            />
          )
        })}
      </div>
    </div>
  )
}
