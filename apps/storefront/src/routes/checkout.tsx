import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
import { Link } from 'react-router'
import { AlertCircle, Check, Clock, Lock, Tag, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-client'
import { formatMoney } from '@/lib/format'
import { useAddresses } from '@/features/addresses/queries'
import { useCreateAddress } from '@/features/addresses/mutations'
import type { AddressValues } from '@/features/addresses/schemas'
import { checkoutApi } from '@/features/checkout/api'
import { useCheckoutSession, useCountdown } from '@/features/checkout/use-checkout'
import { isRazorpayPayload, openRazorpaySheet } from '@/features/checkout/razorpay'
import { addressSummary } from '@/components/address-card'
import { AddressForm } from '@/components/address-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
    setShippingMethod,
    isSettingShippingMethod,
    applyCoupon,
    isApplyingCoupon,
    removeCoupon,
    cancel,
    onPaymentAttempted,
  } = useCheckoutSession()

  usePageMeta({ title: 'Checkout' })

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
      setShippingMethod={setShippingMethod}
      isSettingShippingMethod={isSettingShippingMethod}
      applyCoupon={applyCoupon}
      isApplyingCoupon={isApplyingCoupon}
      removeCoupon={removeCoupon}
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
  setShippingMethod,
  isSettingShippingMethod,
  applyCoupon,
  isApplyingCoupon,
  removeCoupon,
  cancel,
  onPaymentAttempted,
}: {
  session: CheckoutSession
  email: string
  setAddress: (input: { shippingAddressId: string; billingAddressId?: string }) => Promise<unknown>
  isSettingAddress: boolean
  setShippingMethod: (method: string) => Promise<unknown>
  isSettingShippingMethod: boolean
  applyCoupon: (code: string) => Promise<unknown>
  isApplyingCoupon: boolean
  removeCoupon: (couponId: string) => Promise<unknown>
  cancel: () => Promise<unknown>
  onPaymentAttempted: () => void
}) {
  const { data: addresses } = useAddresses()
  const createAddress = useCreateAddress()
  const countdown = useCountdown(session.expiresAt)

  const [addingAddress, setAddingAddress] = React.useState(false)
  /**
   * Both derived from the session rather than assumed, so a refresh lands on
   * the checkout the customer left: a session whose billing differs from its
   * shipping is one where they already unticked the box and chose.
   */
  const [sameAsDelivery, setSameAsDelivery] = React.useState(
    () =>
      !session.billingAddress ||
      !session.shippingAddress ||
      session.billingAddress.id === session.shippingAddress.id,
  )
  const [billingChoice, setBillingChoice] = React.useState(() =>
    session.billingAddress &&
    session.shippingAddress &&
    session.billingAddress.id !== session.shippingAddress.id
      ? session.billingAddress.id
      : '',
  )
  const [paying, setPaying] = React.useState(false)
  const [problem, setProblem] = React.useState<ApiError | null>(null)
  const [acknowledged, setAcknowledged] = React.useState(false)
  /**
   * Anything the provider's own sheet had to say — a declined card, a closed
   * window, a script that would not load. Separate from `problem`, which is an
   * `ApiError` from our API and gates Pay behind an acknowledgement; none of
   * these are our API's answer and none of them un-hold the stock.
   */
  const [handoff, setHandoff] = React.useState<string | null>(null)

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
   * 'new' only opens the form — nothing is written until it is saved, which is
   * why the readiness check below wants a real id rather than a choice.
   */
  const chooseBilling = async (value: string) => {
    setBillingChoice(value)
    if (!value || value === 'new' || !selected) return
    await setAddress({ shippingAddressId: selected.id, billingAddressId: value })
  }

  const saveBillingAddress = async (values: AddressValues) => {
    const created = await createAddress.mutateAsync(values)
    setBillingChoice(created.id)
    if (selected) {
      await setAddress({ shippingAddressId: selected.id, billingAddressId: created.id })
    }
  }

  /**
   * Settled means *the server agrees*: a chosen id that the session has come
   * back carrying. A select that has been touched is not a billing address,
   * and Pay is gated on this rather than on what the dropdown displays (§21).
   */
  const billingSettled =
    sameAsDelivery ||
    (billingChoice !== '' &&
      billingChoice !== 'new' &&
      session.billingAddress?.id === billingChoice)

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
    setHandoff(null)
    const idempotencyKey = crypto.randomUUID()

    try {
      const payment = await checkoutApi.pay(session.id, idempotencyKey)
      // From here the answer arrives from somewhere else. Start watching the
      // session before the provider has said anything, because the thing that
      // would tell us to start watching is the read we are waiting for.
      onPaymentAttempted()

      /**
       * Which provider took the attempt is the server's answer, not this
       * page's guess: `clientPayload` says who it is and carries whatever that
       * one needs. The branch is here and nowhere else.
       */
      if (isRazorpayPayload(payment.clientPayload)) {
        const outcome = await openRazorpaySheet(payment.clientPayload, {
          onFailed: (reason) => setHandoff(reason),
        })
        if (outcome === 'dismissed') {
          /**
           * They closed the sheet. The attempt is still open at Razorpay and
           * the session is still PAYMENT_PENDING, so Pay stays disabled — a
           * second attempt would be answered 409 by design (§7, §25). Saying
           * so beats a button that looks live and is not.
           */
          setHandoff(
            'You closed the payment window. If you did pay, this page will update on its own — otherwise the items are held until the timer runs out.',
          )
        }
        // Still nothing marked paid. Submitted or dismissed, the webhook is
        // what changes the session, and the page is already watching it (§12).
        return
      }

      /**
       * Razorpay is the only provider registered, so a payload this page cannot
       * recognise is a server that has been taught a provider this build has
       * not. Saying so beats falling through and leaving a spinner on a page
       * that will never resolve.
       */
      throw new Error('This payment method is not supported by this version of the site')
    } catch (error) {
      setPaying(false)
      setProblem(error instanceof ApiError ? error : null)
      // A provider that would not load or would not open. Not an ApiError, so
      // `problem` stays null and this is the only thing the customer would see.
      if (!(error instanceof ApiError) && error instanceof Error) setHandoff(error.message)
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

            {/*
              Every saved address, one per line, one of them chosen. The default
              is already selected by the time this renders, so the list is a
              confirmation the customer skims rather than a question — but the
              others are right there, which is the whole difference between
              changing your mind in one click and hunting for a control.
            */}
            {rows.length > 0 && (
              <div className="mt-4 divide-y border">
                {rows.map((address) => {
                  const isChosen = selected?.id === address.id
                  return (
                    <button
                      key={address.id}
                      type="button"
                      onClick={() => void chooseAddress(address)}
                      disabled={isSettingAddress}
                      aria-pressed={isChosen}
                      className={cn(
                        'flex w-full items-start gap-3 p-4 text-left transition-colors',
                        isChosen ? 'bg-secondary/60' : 'hover:bg-secondary/30',
                        isSettingAddress && 'opacity-60',
                      )}
                    >
                      <Radio checked={isChosen} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm">{address.fullName}</span>
                          {address.isDefault && (
                            <span className="text-muted-foreground border px-1.5 py-0.5 text-[10px] tracking-[0.12em] uppercase">
                              Default
                            </span>
                          )}
                        </span>
                        {/* Wraps rather than truncates: an address with its end
                            cut off is an address the customer cannot check. */}
                        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                          {addressSummary(address)}
                          <span className="px-1.5" aria-hidden>
                            ·
                          </span>
                          <span className="tabular-nums">{address.phone}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setAddingAddress(true)}
              className="text-muted-foreground hover:text-foreground mt-3 text-sm underline underline-offset-4 transition-colors"
            >
              {rows.length > 0 ? 'Use a different address' : 'Add a delivery address'}
            </button>

            {/*
              A modal rather than a form pushed into the page: the list, the
              shipping charge and the total all sit around it, and expanding
              seven fields between them shoves the summary the customer is
              reading down the page. It never navigates away — a checkout left
              to add an address is a session still holding the stock.
            */}
            <Dialog open={addingAddress} onOpenChange={setAddingAddress}>
              <DialogContent
                title="Add an address"
                description="Saved to your account, and used for this order."
              >
                <AddressForm
                  onSubmit={saveNewAddress}
                  onCancel={() => setAddingAddress(false)}
                  submitLabel="Save address"
                />
              </DialogContent>
            </Dialog>
          </section>

          {/*
            Between the address and the bill, because it is the last thing that
            changes the total and the first thing a customer in a hurry looks
            for. Every price here was quoted by the server for this order —
            "Free" against standard is the delivery threshold already applied,
            not a label the page decided to draw (§21).
          */}
          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Shipping method</h2>
            <div className="mt-4 divide-y border">
              {session.shippingMethods.map((method) => {
                const isChosen = session.shippingMethod === method.code
                const free = Number(method.amount) === 0
                return (
                  <button
                    key={method.code}
                    type="button"
                    onClick={() => void setShippingMethod(method.code)}
                    disabled={isSettingShippingMethod}
                    aria-pressed={isChosen}
                    className={cn(
                      'flex w-full items-center gap-3 p-4 text-left transition-colors',
                      isChosen ? 'bg-secondary/60' : 'hover:bg-secondary/30',
                      isSettingShippingMethod && 'opacity-60',
                    )}
                  >
                    <Radio checked={isChosen} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{method.label}</span>
                      <span className="text-muted-foreground block text-xs">{method.eta}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">
                      {free ? 'Free' : formatMoney(method.amount)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Billing address</h2>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameAsDelivery}
                onChange={(event) => {
                  const same = event.target.checked
                  setSameAsDelivery(same)
                  setBillingChoice('')
                  // Ticking it puts billing back on the delivery address; the
                  // server does that itself when billing is omitted.
                  if (same && selected) void setAddress({ shippingAddressId: selected.id })
                }}
                className="size-4"
              />
              Same as delivery
            </label>

            {/*
              A dropdown here, a list above. The delivery address is the
              decision of this page and deserves the room; billing is a
              formality almost nobody changes, and giving it an equally loud
              control would make the two look like equal questions.
            */}
            {!sameAsDelivery && (
              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="billing-address">Saved addresses</Label>
                  <Select
                    id="billing-address"
                    className="mt-1.5"
                    value={billingChoice}
                    disabled={isSettingAddress}
                    onChange={(event) => void chooseBilling(event.target.value)}
                  >
                    {/* Nothing is preselected: the customer unticked the box
                        precisely because the delivery address is not the
                        answer, so defaulting back to it would be ignoring
                        what they just said. */}
                    <option value="">Select an address</option>
                    {rows.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.fullName} — {addressSummary(address)}
                      </option>
                    ))}
                    <option value="new">Use a new address</option>
                  </Select>
                </div>

                {billingChoice === 'new' && (
                  <div className="border p-5">
                    <AddressForm
                      onSubmit={saveBillingAddress}
                      onCancel={() => setBillingChoice('')}
                      submitLabel="Use this address"
                    />
                  </div>
                )}

                {/* What was actually chosen, read back. A select showing a
                    truncated line is not a confirmation. */}
                {billingSettled && session.billingAddress && (
                  <div className="border p-4">
                    <p className="text-sm">{session.billingAddress.fullName}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {addressSummary(session.billingAddress)}
                      <span className="px-1.5" aria-hidden>
                        ·
                      </span>
                      <span className="tabular-nums">{session.billingAddress.phone}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xs tracking-[0.14em] uppercase">Payment</h2>
            <div className="mt-3 border p-4">
              <p className="flex items-center gap-2 text-sm">
                <Lock className="size-3.5" />
                Card, UPI or netbanking
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Pay opens Razorpay’s secure window. Card details are entered there and never reach
                this site — your order is confirmed once Razorpay tells us the payment went through.
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
                {/*
                  The count sits on the corner of the photo rather than in the
                  line of text below it: what a customer checks in a summary is
                  "the right things, in the right numbers", and a quantity
                  buried after the colour and size is one they have to hunt for.

                  Two elements deep because the frame crops the photo, and a
                  badge that overhangs the corner cannot live inside something
                  with `overflow-hidden`.
                */}
                <div className="relative shrink-0">
                  <div className="bg-secondary relative h-16 w-14 overflow-hidden">
                    {item.image && (
                      <img
                        src={item.image.url}
                        alt={item.image.altText ?? item.title}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <span
                    aria-hidden
                    className="bg-background text-muted-foreground absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full border text-[10px] leading-none tabular-nums"
                  >
                    {item.quantity}
                  </span>
                  <span className="sr-only">{`Quantity ${item.quantity}`}</span>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">{item.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.options.map((option) => option.value).join(' / ')}
                  </p>

                  {/*
                    The code, against the line it actually came off. A single
                    saving at the bottom of the summary leaves the customer to
                    work out which item it applied to — and with several codes
                    on one cart, that is not something they can work out.
                  */}
                  {item.discount && (
                    <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                      <Tag className="size-3 shrink-0" aria-hidden />
                      <span className="truncate font-mono">{item.discount.code}</span>
                      <span className="tabular-nums">(−{formatMoney(item.discount.amount)})</span>
                    </p>
                  )}

                  <p className="mt-0.5 tabular-nums">
                    {item.discount ? (
                      <>
                        {/* The old price stays visible: a discount nobody can
                            see the size of is a price they have to take on
                            trust. */}
                        <span className="text-muted-foreground mr-1.5 line-through">
                          {formatMoney(item.totalPrice)}
                        </span>
                        {formatMoney(item.discountedTotal)}
                      </>
                    ) : (
                      formatMoney(item.totalPrice)
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <DiscountBox
            session={session}
            apply={applyCoupon}
            isApplying={isApplyingCoupon}
            remove={removeCoupon}
          />

          {/*
            Subtotal is the lines as they will be charged — discounts already
            taken off. No separate Discount row: each saving is shown against
            the item it came off, and repeating the total here would be the same
            money named twice in one column.
          */}
          <dl className="mt-4 space-y-1.5 border-t pt-4 text-sm">
            <Row label="Subtotal" value={session.goodsTotal} />

            {/*
              An order discount is against the whole cart, so unlike a product
              discount there is no line to show it on — it gets a row, named by
              its code so the customer can tell which of their codes did it.
            */}
            {session.discounts
              .filter((discount) => discount.kind === 'ORDER' && Number(discount.amount) > 0)
              .map((discount) => (
                <Row key={discount.couponId} label={discount.code} value={`-${discount.amount}`} />
              ))}
            <Row
              label="Shipping"
              value={session.shippingAmount}
              hint={Number(session.shippingAmount) === 0 ? 'Free delivery applied' : undefined}
            />

            {/* Under the rate it came off, so the two read as one thought. */}
            {session.discounts
              .filter((discount) => discount.kind === 'SHIPPING' && Number(discount.amount) > 0)
              .map((discount) => (
                <Row key={discount.couponId} label={discount.code} value={`-${discount.amount}`} />
              ))}
          </dl>

          <div className="mt-3 flex items-baseline justify-between border-t pt-3">
            <span className="text-sm">Total</span>
            <span className="tabular-nums">{formatMoney(session.totalAmount)}</span>
          </div>

          {/*
            The one figure that is not part of the arithmetic above: everything
            saved, in one place, after the customer has read what they are
            paying. Hidden entirely when it is zero — "Total savings ₹0" is a
            line that only ever points out what somebody did not get.
          */}
          {Number(session.totalDiscount) > 0 && (
            <p className="mt-2 flex items-baseline justify-between">
              <span className="text-xs tracking-[0.14em] uppercase">Total savings</span>
              <span className="text-sm tabular-nums">{formatMoney(session.totalDiscount)}</span>
            </p>
          )}

          <Button
            variant="accent"
            size="lg"
            className="mt-5 w-full"
            disabled={paying || blocked || expiredByClock || !selected || !billingSettled}
            onClick={() => void pay()}
          >
            {paying && <Spinner />}
            {paying ? 'Confirming your payment…' : `Pay ${formatMoney(session.totalAmount)}`}
          </Button>

          {/*
            What the provider's own window said. Above the gating hints on
            purpose: it is the most recent thing that happened, and the hints
            below are about a button that is now disabled for another reason.
          */}
          {handoff && <p className="mt-2 text-xs">{handoff}</p>}

          {/* One reason at a time, in the order the page asks for them. */}
          {!selected ? (
            <p className="text-muted-foreground mt-2 text-xs">Choose a delivery address first.</p>
          ) : !billingSettled ? (
            <p className="text-muted-foreground mt-2 text-xs">Choose a billing address first.</p>
          ) : null}

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

/** The dot, drawn rather than an <input type="radio"> — the row is the control. */
function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border',
        checked && 'border-foreground',
      )}
    >
      {checked && <span className="bg-foreground size-1.5 rounded-full" />}
    </span>
  )
}

/**
 * The discount box: below the items, above the totals — where a customer looks
 * once they have checked what they are buying and before they look at what it
 * costs.
 *
 * Several codes can sit here at once. Each shows what it is actually worth
 * after the server has allocated the lines, so a code that lost every line to a
 * better one reads **₹0** rather than pretending. That is the one thing that
 * tells the customer which code to take off.
 */
function DiscountBox({
  session,
  apply,
  isApplying,
  remove,
}: {
  session: CheckoutSession
  apply: (code: string) => Promise<unknown>
  isApplying: boolean
  remove: (couponId: string) => Promise<unknown>
}) {
  const [code, setCode] = React.useState('')
  const [problem, setProblem] = React.useState<ApiError | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return
    setProblem(null)
    try {
      await apply(trimmed)
      setCode('')
    } catch (error) {
      // Kept on screen rather than toasted: the customer is about to retype it,
      // and a message that fades is a message they read half of (§16).
      setProblem(error instanceof ApiError ? error : null)
    }
  }

  return (
    <div className="mt-5 border-t pt-4">
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <label htmlFor="discount-code" className="sr-only">
          Discount code
        </label>
        <input
          id="discount-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            if (problem) setProblem(null)
          }}
          placeholder="Discount code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="border-input placeholder:text-muted-foreground h-10 min-w-0 flex-1 border bg-transparent px-3 text-sm uppercase transition-colors outline-none focus-visible:border-foreground"
        />
        <Button type="submit" variant="outline" disabled={isApplying || code.trim() === ''}>
          {isApplying && <Spinner />}
          Apply
        </Button>
      </form>

      {/*
        A banner, not a line of red text under the field. A refused code is the
        one thing on this page the customer has to read and act on — "spend
        ₹2,000 on eligible items" is a thing they can do something about, and it
        has to survive them looking away to check their bag (§16).
      */}
      {problem && (
        <Alert variant="destructive" className="mt-3">
          <AlertCircle />
          <AlertDescription>
            <p className="font-medium">{problem.message}</p>
            {problem.reason && <p className="text-muted-foreground mt-0.5">{problem.reason}</p>}
          </AlertDescription>
        </Alert>
      )}

      {/*
        Chips only. What each code is worth is shown against the line it came
        off, and repeating it here would have the customer adding figures up to
        check they agree — the summary below already does that.
      */}
      {session.discounts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {session.discounts.map((discount) => (
            <li key={discount.couponId}>
              <span className="bg-secondary inline-flex items-center gap-1.5 px-2 py-1 font-mono text-xs tracking-wide">
                <Tag className="size-3 shrink-0" aria-hidden />
                {discount.code}
                <button
                  type="button"
                  onClick={() => void remove(discount.couponId)}
                  aria-label={`Remove ${discount.code}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3" />
                </button>
              </span>
              {/*
                The exception, because it is not a figure but a reason: a code
                that won nothing looks broken otherwise, and this is what tells
                the customer it is the one to take off.
              */}
              {Number(discount.amount) === 0 && (
                <span className="text-muted-foreground mt-1 block text-xs">
                  no saving — another code covers those items
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
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
  const orderNumber = session.order?.orderNumber
  return (
    <Terminal
      icon={<Check className="size-8" />}
      title="Order confirmed"
      lines={[
        `Your order number is ${orderNumber ?? '—'}.`,
        'We have emailed the details.',
      ]}
      // Straight to the order rather than to the catalog: what somebody wants
      // immediately after paying is to see what they just bought.
      action={
        orderNumber
          ? { to: `/account/orders/${orderNumber}`, label: 'View your order' }
          : { to: '/collections', label: 'Continue shopping' }
      }
      secondary={{ to: '/collections', label: 'Continue shopping' }}
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
  secondary,
}: {
  icon: React.ReactNode
  title: string
  lines: string[]
  action: { to: string; label: string }
  secondary?: { to: string; label: string }
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
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild variant="accent">
          <Link to={action.to}>{action.label}</Link>
        </Button>
        {secondary && (
          <Button asChild variant="outline">
            <Link to={secondary.to}>{secondary.label}</Link>
          </Button>
        )}
      </div>
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
