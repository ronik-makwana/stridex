import * as React from 'react'
import { Link } from 'react-router'
import { AlertCircle, Check, Clock, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-client'
import { formatMoney } from '@/lib/format'
import { useAddresses } from '@/features/addresses/queries'
import { useCreateAddress } from '@/features/addresses/mutations'
import type { AddressValues } from '@/features/addresses/schemas'
import { checkoutApi } from '@/features/checkout/api'
import { useCheckoutSession, useCountdown } from '@/features/checkout/use-checkout'
import { AddressLines } from '@/components/address-card'
import { AddressForm } from '@/components/address-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { Address, CheckoutSession } from '@/types/api'

/**
 * One page, not a wizard. Form on the left, summary sticky on the right, and
 * the only thing that decides anything is the server.
 *
 * The states this has to render are the reason it was built last: an expired
 * session, a payment the provider is still deciding, a session that a second
 * tab already turned into an order. All of them exist now, so none of them is
 * mocked here.
 */
export default function CheckoutPage() {
  const { user } = useAuth()
  const {
    session,
    isLoading,
    createError,
    loadError,
    setAddress,
    isSettingAddress,
    cancel,
    onPaymentAttempted,
  } = useCheckoutSession()

  React.useEffect(() => {
    document.title = 'Checkout · StrideX'
  }, [])

  if (isLoading) return <CheckoutSkeleton />

  // A checkout that could not be created: every line that failed, named (§16).
  if (createError) return <CannotStart error={createError} />
  if (loadError) return <CannotStart error={loadError} />
  if (!session) return <CheckoutSkeleton />

  if (session.status === 'COMPLETED') return <Confirmed session={session} />
  if (session.status === 'EXPIRED') return <Expired />
  if (session.status === 'CANCELLED') return <Cancelled />

  return (
    <Live
      session={session}
      email={user?.email ?? ''}
      setAddress={setAddress}
      isSettingAddress={isSettingAddress}
      cancel={cancel}
      onPaymentAttempted={onPaymentAttempted}
    />
  )
}

// ─── the live checkout ───────────────────────────────────────────────────────

function Live({
  session,
  email,
  setAddress,
  isSettingAddress,
  cancel,
  onPaymentAttempted,
}: {
  session: CheckoutSession
  email: string
  setAddress: (input: { shippingAddressId: string; billingAddressId?: string }) => Promise<unknown>
  isSettingAddress: boolean
  cancel: () => Promise<unknown>
  onPaymentAttempted: () => void
}) {
  const { data: addresses } = useAddresses()
  const createAddress = useCreateAddress()
  const countdown = useCountdown(session.expiresAt)

  const [addingAddress, setAddingAddress] = React.useState(false)
  const [sameAsDelivery, setSameAsDelivery] = React.useState(true)
  const [paying, setPaying] = React.useState(false)
  const [problem, setProblem] = React.useState<ApiError | null>(null)
  const [acknowledged, setAcknowledged] = React.useState(false)

  const rows = addresses ?? []
  const selected = session.shippingAddress

  // Nothing is chosen and something is saved: pick the default rather than
  // making the customer choose what they already told us.
  React.useEffect(() => {
    if (selected || rows.length === 0 || isSettingAddress) return
    const fallback = rows.find((address) => address.isDefault) ?? rows[0]
    if (fallback) void setAddress({ shippingAddressId: fallback.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, selected])

  const chooseAddress = async (address: Address) => {
    await setAddress({
      shippingAddressId: address.id,
      billingAddressId: sameAsDelivery ? undefined : session.billingAddress?.id,
    })
  }

  const saveNewAddress = async (values: AddressValues) => {
    const created = await createAddress.mutateAsync(values)
    setAddingAddress(false)
    await setAddress({ shippingAddressId: created.id })
  }

  /**
   * Pay disables on click and does not re-enable. Recovery is a reload, which
   * restores state from the session — re-enabling after a timeout is exactly
   * how the second payment gets made that the idempotency key then has to
   * catch (§13).
   *
   * The key is generated once, here, per attempt.
   */
  const pay = async () => {
    setPaying(true)
    setProblem(null)
    const idempotencyKey = crypto.randomUUID()

    try {
      const payment = await checkoutApi.pay(session.id, idempotencyKey)
      // From here the answer arrives from somewhere else. Start watching the
      // session before the provider has said anything, because the thing that
      // would tell us to start watching is the read we are waiting for.
      onPaymentAttempted()
      /**
       * Development stands in for the provider's hosted page. The API signs a
       * webhook and posts it to its own endpoint, so what runs from here is the
       * real path — signature check, parse, order write — not a shortcut.
       */
      await checkoutApi.mockComplete(payment.id, 'success')
      // Nothing is marked paid here. The page now watches the session, and the
      // webhook is what changes it (§12).
    } catch (error) {
      setPaying(false)
      setProblem(error instanceof ApiError ? error : null)
    }
  }

  const expiredByClock = countdown.expired
  // A revalidation problem gates Pay until it is acknowledged — a block in the
  // flow, not a toast that disappears while the customer is reading it (§16).
  const blocked = Boolean(problem) && !acknowledged

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl sm:text-2xl">Checkout</h1>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm tabular-nums">
          <Clock className="size-3.5" />
          {expiredByClock ? 'Expired' : `Expires in ${countdown.text}`}
        </p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Contact</h2>
            <p className="mt-3 text-sm">{email}</p>
          </section>

          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Delivery address</h2>

            {rows.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {rows.map((address) => {
                  const isChosen = selected?.id === address.id
                  return (
                    <button
                      key={address.id}
                      type="button"
                      onClick={() => void chooseAddress(address)}
                      disabled={isSettingAddress}
                      className={cn(
                        'border p-4 text-left transition-colors',
                        isChosen ? 'border-foreground' : 'hover:border-foreground/40',
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs tracking-[0.14em] uppercase">
                        <span
                          className={cn(
                            'inline-flex size-3.5 items-center justify-center rounded-full border',
                            isChosen && 'border-foreground',
                          )}
                        >
                          {isChosen && <span className="bg-foreground size-1.5 rounded-full" />}
                        </span>
                        {address.isDefault ? 'Default' : 'Address'}
                      </span>
                      <div className="mt-2">
                        <AddressLines address={address} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {addingAddress ? (
              <div className="mt-4 border p-5">
                {/* Expands inline. Navigating away to add an address is how a
                    customer loses a session that is holding their stock. */}
                <AddressForm
                  onSubmit={saveNewAddress}
                  onCancel={() => setAddingAddress(false)}
                  submitLabel="Use this address"
                />
              </div>
            ) : (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setAddingAddress(true)}>
                + Use a new address
              </Button>
            )}
          </section>

          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Billing address</h2>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameAsDelivery}
                onChange={(event) => {
                  setSameAsDelivery(event.target.checked)
                  if (event.target.checked && selected) {
                    void setAddress({ shippingAddressId: selected.id })
                  }
                }}
                className="size-4"
              />
              Same as delivery
            </label>
            {!sameAsDelivery && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {rows.map((address) => (
                  <button
                    key={address.id}
                    type="button"
                    onClick={() =>
                      selected &&
                      void setAddress({ shippingAddressId: selected.id, billingAddressId: address.id })
                    }
                    className={cn(
                      'border p-4 text-left text-sm transition-colors',
                      session.billingAddress?.id === address.id
                        ? 'border-foreground'
                        : 'hover:border-foreground/40',
                    )}
                  >
                    <AddressLines address={address} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Payment</h2>
            <div className="mt-3 border p-4">
              <p className="flex items-center gap-2 text-sm">
                <Lock className="size-3.5" />
                Test payments
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                No card is taken. The API signs a provider webhook and sends it to itself, so the
                order is created the same way a real payment would create it.
              </p>
            </div>
          </section>

          {/*
            The block, not a toast. Pay stays disabled until it is acknowledged,
            because a warning that fades is a price the customer never saw.
          */}
          {problem && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                <p className="font-medium">{problem.message}</p>
                {problem.reason && <p className="text-muted-foreground mt-1">{problem.reason}</p>}
                {problem.fields && (
                  <ul className="text-muted-foreground mt-2 list-disc pl-4">
                    {Object.entries(problem.fields).map(([key, message]) => (
                      <li key={key}>{message}</li>
                    ))}
                  </ul>
                )}
                {!acknowledged && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setAcknowledged(true)}>
                    I understand, continue
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* ── the summary. Every figure here came from the server (§21). ── */}
        <aside className="h-fit border p-5 lg:sticky lg:top-24">
          <h2 className="text-xs tracking-[0.14em] uppercase">
            {session.items.length} {session.items.length === 1 ? 'item' : 'items'}
          </h2>

          <ul className="mt-4 space-y-3">
            {session.items.map((item) => (
              <li key={item.id} className="flex gap-3">
                <div className="bg-secondary relative h-16 w-14 shrink-0 overflow-hidden">
                  {item.image && (
                    <img
                      src={item.image.url}
                      alt={item.image.altText ?? item.title}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">{item.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.options.map((option) => option.value).join(' / ')} · {item.quantity}
                  </p>
                  <p className="mt-0.5 tabular-nums">{formatMoney(item.totalPrice)}</p>
                </div>
              </li>
            ))}
          </ul>

          <dl className="mt-5 space-y-1.5 border-t pt-4 text-sm">
            <Row label="Subtotal" value={session.subtotal} />
            {Number(session.discountAmount) > 0 && (
              <Row label="Discount" value={`-${session.discountAmount}`} />
            )}
            <Row
              label="Shipping"
              value={session.shippingAmount}
              hint={Number(session.shippingAmount) === 0 ? 'Free delivery applied' : undefined}
            />
          </dl>

          <div className="mt-3 flex items-baseline justify-between border-t pt-3">
            <span className="text-sm">Total</span>
            <span className="tabular-nums">{formatMoney(session.totalAmount)}</span>
          </div>

          <Button
            variant="accent"
            size="lg"
            className="mt-5 w-full"
            disabled={paying || blocked || expiredByClock || !selected}
            onClick={() => void pay()}
          >
            {paying && <Spinner />}
            {paying ? 'Confirming your payment…' : `Pay ${formatMoney(session.totalAmount)}`}
          </Button>

          {!selected && (
            <p className="text-muted-foreground mt-2 text-xs">Choose a delivery address first.</p>
          )}

          <button
            type="button"
            onClick={() => void cancel()}
            disabled={paying}
            className="text-muted-foreground hover:text-foreground mt-4 w-full text-center text-xs underline underline-offset-4 disabled:opacity-40"
          >
            Cancel and return the items
          </button>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="ml-2 text-xs">{hint}</span>}
      </dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  )
}

// ─── terminal states ─────────────────────────────────────────────────────────

function Confirmed({ session }: { session: CheckoutSession }) {
  return (
    <Terminal
      icon={<Check className="size-8" />}
      title="Order confirmed"
      lines={[
        `Your order number is ${session.order?.orderNumber ?? '—'}.`,
        'We have emailed the details. Your order history arrives with the account screens.',
      ]}
      action={{ to: '/collections', label: 'Continue shopping' }}
    />
  )
}

function Expired() {
  return (
    <Terminal
      icon={<Clock className="size-8" />}
      title="Your checkout expired"
      lines={[
        'Your items are still in your cart.',
        'Prices and stock are re-checked when you start again.',
      ]}
      action={{ to: '/cart', label: 'Start checkout again' }}
    />
  )
}

function Cancelled() {
  return (
    <Terminal
      icon={<AlertCircle className="size-8" />}
      title="This checkout was cancelled"
      lines={['Nothing was charged, and your items are back in your cart.']}
      action={{ to: '/cart', label: 'Back to your cart' }}
    />
  )
}

function CannotStart({ error }: { error: ApiError }) {
  return (
    <Terminal
      icon={<AlertCircle className="size-8" />}
      title={error.message}
      lines={[
        error.reason ?? 'Review your cart and try again.',
        ...Object.values(error.fields ?? {}),
      ]}
      action={{ to: '/cart', label: 'Back to your cart' }}
    />
  )
}

function Terminal({
  icon,
  title,
  lines,
  action,
}: {
  icon: React.ReactNode
  title: string
  lines: string[]
  action: { to: string; label: string }
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <h1 className="mt-5 text-xl">{title}</h1>
      {lines.filter(Boolean).map((line) => (
        <p key={line} className="text-muted-foreground mt-2 text-sm">
          {line}
        </p>
      ))}
      <Button asChild variant="accent" className="mt-6">
        <Link to={action.to}>{action.label}</Link>
      </Button>
    </div>
  )
}

function CheckoutSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Skeleton className="h-8 w-40" />
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}
