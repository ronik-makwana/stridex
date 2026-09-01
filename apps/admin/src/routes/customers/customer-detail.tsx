import * as React from 'react'
import { Link, useParams } from 'react-router'
import { SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import {
  useCustomer,
  useCustomerAddresses,
  useCustomerBasket,
  useCustomerOrders,
  useCustomerSessions,
} from '@/features/customers/queries'
import { useRevokeCustomerSessions, useSetCustomerStatus } from '@/features/customers/mutations'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/order-status-badge'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const TABS = ['Overview', 'Orders', 'Addresses', 'Cart & wishlist', 'Sessions'] as const
type Tab = (typeof TABS)[number]

/**
 * One customer, in tabs, because a support call is a sequence of different
 * questions — what have they bought, where does it go, what are they looking at
 * right now, and are they still signed in somewhere they should not be.
 *
 * Each tab fetches only when it is opened: five panels loaded up front is five
 * queries for the one somebody wanted.
 */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = React.useState<Tab>('Overview')
  const [confirming, setConfirming] = React.useState<'suspend' | 'revoke' | null>(null)

  const { data: customer, isPending, error } = useCustomer(id)
  const setStatus = useSetCustomerStatus()
  const revokeSessions = useRevokeCustomerSessions()

  if (isPending) return <DetailSkeleton />

  if (error || !customer) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That customer no longer exists' : 'Could not load this customer'}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/customers">Back to customers</Link>
          </Button>
        }
      />
    )
  }

  const suspended = customer.status === 'SUSPENDED'

  const act = async (run: () => Promise<unknown>, success: string) => {
    try {
      await run()
      toast.success(success)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'That did not work')
    } finally {
      setConfirming(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/customers"
        backLabel="Back to customers"
        title={customer.name ?? customer.email}
        actions={
          <>
            {suspended && <Badge variant="destructive">Suspended</Badge>}
            {!customer.emailVerified && <Badge variant="muted">Unverified</Badge>}
            <Button variant="outline" onClick={() => setConfirming('revoke')}>
              Sign out everywhere
            </Button>
            <Button
              variant={suspended ? 'default' : 'outline'}
              onClick={() => setConfirming('suspend')}
            >
              {suspended ? 'Reactivate' : 'Suspend'}
            </Button>
          </>
        }
      />

      <nav className="flex gap-1 border-b">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm transition-colors',
              tab === name
                ? 'border-foreground text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {name}
          </button>
        ))}
      </nav>

      {tab === 'Overview' && <Overview customer={customer} />}
      {tab === 'Orders' && <OrdersTab id={customer.id} />}
      {tab === 'Addresses' && <AddressesTab id={customer.id} />}
      {tab === 'Cart & wishlist' && <BasketTab id={customer.id} />}
      {tab === 'Sessions' && <SessionsTab id={customer.id} />}

      <ConfirmDialog
        open={confirming === 'suspend'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={suspended ? `Reactivate ${customer.email}?` : `Suspend ${customer.email}?`}
        description={
          suspended
            ? 'They will be able to sign in again. Existing sessions were already ended when they were suspended, if you ended them.'
            : 'They will not be able to sign in. Sessions already open stay open until you end them separately — the two are different decisions.'
        }
        confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
        variant={suspended ? 'default' : 'destructive'}
        onConfirm={() =>
          act(
            () =>
              setStatus.mutateAsync({
                id: customer.id,
                status: suspended ? 'ACTIVE' : 'SUSPENDED',
              }),
            suspended ? 'Account reactivated' : 'Account suspended',
          )
        }
      />

      <ConfirmDialog
        open={confirming === 'revoke'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Sign ${customer.email} out everywhere?`}
        description="Every device they are signed in on will be signed out. They can sign back in unless the account is also suspended."
        confirmLabel="Sign out everywhere"
        onConfirm={() =>
          act(() => revokeSessions.mutateAsync(customer.id), 'Signed out of every device')
        }
      />
    </div>
  )
}

function Overview({ customer }: { customer: import('@/types/api').Customer }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="bg-card space-y-3 rounded-lg border p-5 text-sm">
        <h2 className="font-semibold">Contact</h2>
        <Field label="Name" value={customer.name ?? '—'} />
        <Field label="Email" value={customer.email} />
        <Field
          label="Email verified"
          value={customer.emailVerified ? formatDate(customer.emailVerifiedAt) : 'Not verified'}
        />
        <Field label="Phone" value={customer.phone ?? '—'} />
        <Field label="Joined" value={formatDate(customer.createdAt)} />
      </section>

      <section className="bg-card space-y-3 rounded-lg border p-5 text-sm">
        <h2 className="font-semibold">Lifetime value</h2>
        <Field label="Paid orders" value={String(customer.orderCount)} />
        <Field label="Total spent" value={formatMoney(customer.totalSpent)} />
        <p className="text-muted-foreground text-xs">
          Paid orders only. A failed or abandoned checkout is not money anybody spent.
        </p>
      </section>
    </div>
  )
}

function OrdersTab({ id }: { id: string }) {
  const { data, isPending } = useCustomerOrders(id, true)
  if (isPending) return <Skeleton className="h-40 w-full rounded-lg" />
  if (!data || data.data.length === 0) {
    return <Panel>No orders yet.</Panel>
  }
  return (
    <div className="bg-card divide-y rounded-lg border">
      {data.data.map((order) => (
        <Link
          key={order.id}
          to={`/orders/${order.id}`}
          className="hover:bg-secondary/50 flex items-center justify-between gap-4 px-5 py-3 transition-colors"
        >
          <div>
            <p className="text-sm tabular-nums">{order.orderNumber}</p>
            <p className="text-muted-foreground text-xs">
              {formatDate(order.placedAt ?? order.createdAt)} · {order.itemCount} items
            </p>
          </div>
          <div className="flex items-center gap-3">
            <PaymentStatusBadge status={order.paymentStatus} />
            <OrderStatusBadge status={order.status} />
            <span className="text-sm tabular-nums">{formatMoney(order.totalAmount)}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function AddressesTab({ id }: { id: string }) {
  const { data, isPending } = useCustomerAddresses(id, true)
  if (isPending) return <Skeleton className="h-40 w-full rounded-lg" />
  if (!data || data.length === 0) return <Panel>No saved addresses.</Panel>
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.map((address) => (
        <section key={address.id} className="bg-card rounded-lg border p-5 text-sm">
          <p className="text-xs tracking-[0.14em] uppercase">
            {address.isDefault ? 'Default' : 'Address'}
          </p>
          <div className="text-muted-foreground mt-2 leading-relaxed">
            <p className="text-foreground">{address.fullName}</p>
            <p>{address.addressLine1}</p>
            {address.addressLine2 && <p>{address.addressLine2}</p>}
            <p>
              {address.city}, {address.state} {address.postalCode}
            </p>
            <p className="tabular-nums">{address.phone}</p>
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * Read-only, and genuinely useful: "it says out of stock" is answerable from
 * here instead of asking the customer to read their screen out.
 */
function BasketTab({ id }: { id: string }) {
  const { data, isPending } = useCustomerBasket(id, true)
  if (isPending) return <Skeleton className="h-40 w-full rounded-lg" />
  if (!data) return null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="bg-card rounded-lg border">
        <h2 className="border-b px-5 py-3 text-sm font-semibold">Cart</h2>
        {data.cart.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">Empty.</p>
        ) : (
          <ul className="divide-y">
            {data.cart.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{item.title}</p>
                  <p className="text-muted-foreground text-xs">SKU {item.sku}</p>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {formatMoney(item.price)} × {item.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card rounded-lg border">
        <h2 className="border-b px-5 py-3 text-sm font-semibold">Wishlist</h2>
        {data.wishlist.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">Nothing saved.</p>
        ) : (
          <ul className="divide-y">
            {data.wishlist.map((item) => (
              <li key={item.id} className="px-5 py-3 text-sm">
                <p className="truncate">{item.title}</p>
                <p className="text-muted-foreground text-xs">Saved {formatDate(item.savedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SessionsTab({ id }: { id: string }) {
  const { data, isPending } = useCustomerSessions(id, true)
  if (isPending) return <Skeleton className="h-40 w-full rounded-lg" />
  if (!data || data.length === 0) return <Panel>Not signed in anywhere.</Panel>
  return (
    <div className="bg-card divide-y rounded-lg border">
      {data.map((session) => (
        <div key={session.id} className="px-5 py-3 text-sm">
          <p className="truncate">{session.userAgent ?? 'Unknown device'}</p>
          <p className="text-muted-foreground text-xs">
            {session.ipAddress ?? 'no ip'} · started {formatDateTime(session.createdAt)} · expires{' '}
            {formatDateTime(session.expiresAt)}
          </p>
        </div>
      ))}
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card text-muted-foreground rounded-lg border px-5 py-8 text-center text-sm">
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p>{value}</p>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  )
}
