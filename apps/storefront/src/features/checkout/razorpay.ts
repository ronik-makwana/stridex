/**
 * The browser half of the Razorpay handoff.
 *
 * What it deliberately does **not** do is decide anything. Razorpay's `handler`
 * fires with a signature the page could in principle verify, and every tutorial
 * on the internet posts that back to a `/verify` endpoint which then marks the
 * order paid. This codebase does not have that endpoint on purpose: a browser
 * saying "it worked" is a browser, not a bank (§12). The modal closing is a UI
 * event and nothing more — the webhook writes the order, and the page finds out
 * by watching the session.
 *
 * So the promise here resolves with how the *sheet* ended, never with whether
 * money moved.
 */

/** What `createPayment` sent down for this provider, and nothing else. */
export type RazorpayClientPayload = {
  provider: 'razorpay'
  /** `rzp_test_…` / `rzp_live_…`. Public by design — it identifies the merchant. */
  key: string
  orderId: string
  /** Paise, as Razorpay counts. */
  amount: number
  currency: string
  name: string
  prefill?: { email?: string }
}

export function isRazorpayPayload(payload: unknown): payload is RazorpayClientPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { provider?: unknown }).provider === 'razorpay'
  )
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

type RazorpayConstructor = new (options: Record<string, unknown>) => { open: () => void }

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

/**
 * Loaded on demand rather than in `index.html`.
 *
 * A third-party payment script on every page view is a third-party script
 * watching people browse shoes, and it is only needed by one button. The
 * promise is cached on the element itself so a customer who dismisses the sheet
 * and pays again does not fetch it twice.
 */
let loading: Promise<RazorpayConstructor> | null = null

export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loading) return loading

  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      // Loaded but no global: a proxy or an extension served something else.
      // Failing here is better than a TypeError inside the click handler.
      if (window.Razorpay) resolve(window.Razorpay)
      else reject(new Error('The payment sheet did not load correctly'))
    }
    script.onerror = () => {
      // Let the next attempt try again rather than caching the failure — this
      // is usually an offline moment or a blocker, both of which change.
      loading = null
      reject(new Error('Could not load the payment sheet'))
    }
    document.head.appendChild(script)
  })

  return loading
}

/**
 * How the sheet ended.
 *
 * `submitted` means the customer completed it and Razorpay called back. It does
 * **not** mean captured — that word belongs to the webhook.
 *
 * `dismissed` means they closed it. The attempt stays open at the provider and
 * the session stays PAYMENT_PENDING, which is why the page says so rather than
 * quietly re-enabling a button that would 409.
 */
export type SheetOutcome = 'submitted' | 'dismissed'

export async function openRazorpaySheet(
  payload: RazorpayClientPayload,
  options: { onFailed?: (reason: string) => void } = {},
): Promise<SheetOutcome> {
  const Razorpay = await loadRazorpay()

  return new Promise<SheetOutcome>((resolve) => {
    /**
     * `settle` because both callbacks can fire for one sheet: Razorpay calls
     * `handler` and then, closing the modal behind it, `ondismiss`. Whichever
     * lands first is the true answer, and the second must not overwrite a
     * `submitted` with a `dismissed`.
     */
    let settled = false
    const settle = (outcome: SheetOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    const instance = new Razorpay({
      key: payload.key,
      amount: payload.amount,
      currency: payload.currency,
      name: payload.name,
      order_id: payload.orderId,
      prefill: payload.prefill ?? {},
      // Razorpay's default is a dark blue that belongs to Razorpay. Neutral,
      // because this sheet is meant to read as part of the shop.
      theme: { color: '#111111' },
      /**
       * Success, as far as the sheet is concerned. The response carries
       * `razorpay_payment_id` and a signature; both are ignored here, and the
       * comment at the top of this file is why.
       */
      handler: () => settle('submitted'),
      modal: {
        ondismiss: () => settle('dismissed'),
        // Closing by clicking the backdrop, mid-payment, is almost always an
        // accident. The X still works.
        escape: false,
      },
    })

    /**
     * A declined card, a failed UPI mandate, a 3DS the bank rejected. The sheet
     * stays open and lets them try another method, so this is a message and not
     * an outcome — the promise settles when they close it or succeed.
     */
    const withEvents = instance as typeof instance & {
      on?: (event: string, handler: (response: unknown) => void) => void
    }
    withEvents.on?.('payment.failed', (response) => {
      const description = (response as { error?: { description?: string } })?.error?.description
      options.onFailed?.(description ?? 'That payment did not go through')
    })

    instance.open()
  })
}
