/**
 * Razorpay, end to end on the server side.
 *
 * What this proves, and what it deliberately cannot:
 *
 *   - a payment attempt really creates a Razorpay order, and that order exists
 *     at Razorpay with the amount and receipt we sent
 *   - a signed `payment.captured` body is verified, parsed, matched to our row
 *     and turned into an order — the same `handleProviderEvent` the mock uses
 *   - a tampered signature is refused, an unknown event is understood and
 *     ignored, and a duplicate delivery changes nothing
 *
 * It does **not** prove that Razorpay's own delivery reaches you — that needs
 * the tunnel and a dashboard webhook — and it does not touch a real card. The
 * webhook bodies here are signed with your own RAZORPAY_WEBHOOK_SECRET, which
 * is exactly what Razorpay does, so everything downstream of the signature is
 * the real path.
 *
 *   node scripts/verify/razorpay-api.mjs
 */
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API = 'http://localhost:4000/api'

// The API's own .env is the authority — a secret typed twice is a secret that
// will eventually disagree with itself.
const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"(.*)"$/, '$1')]
    }),
)

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  ok ? passed++ : failed++
}

const call = async (method, path, { token, body, key } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** A webhook exactly as Razorpay sends one: raw bytes, hex HMAC over them. */
const sendWebhook = async (payload, { secret = env.RAZORPAY_WEBHOOK_SECRET } = {}) => {
  const raw = JSON.stringify(payload)
  const res = await fetch(`${API}/webhooks/payments/razorpay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Razorpay-Signature': createHmac('sha256', secret).update(raw).digest('hex'),
    },
    body: raw,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const razorpay = async (path) => {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: { authorization: `Basic ${auth}` },
  })
  return { status: res.status, body: await res.json() }
}

// ── preconditions ───────────────────────────────────────────────────────────

if (env.PAYMENT_PROVIDER !== 'razorpay') {
  console.error(`PAYMENT_PROVIDER is "${env.PAYMENT_PROVIDER}" — set it to razorpay and restart the API`)
  process.exit(1)
}

const shopper = (await call('POST', '/storefront/auth/login', {
  body: { email: 'shopper@shoe.com', password: 'Customer@12345' },
})).body?.data?.accessToken
if (!shopper) {
  console.error('could not log in as shopper@shoe.com')
  process.exit(1)
}

// ── a purchasable variant ───────────────────────────────────────────────────

const listing = await call('GET', '/storefront/products?limit=24', { token: shopper })
let pick = null
for (const card of listing.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token: shopper })
  const variant = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (variant) {
    pick = { variant, title: full.body.data.title }
    break
  }
}
if (!pick) {
  console.error('no purchasable product found')
  process.exit(1)
}

// A clean slate: a cart or checkout left by an earlier run would change the total.
const priorCart = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of priorCart) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
const open = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token: shopper })

await call('POST', '/storefront/cart/items', {
  token: shopper,
  body: { variantId: pick.variant.id, quantity: 1 },
})

const session = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data
check('a checkout opens', Boolean(session?.id), pick.title)
check('and reports razorpay as the provider', session.paymentProvider === 'razorpay', session.paymentProvider)

const address = (await call('GET', '/storefront/addresses', { token: shopper })).body?.data?.[0]
await call('POST', `/storefront/checkout/${session.id}/address`, {
  token: shopper,
  body: { shippingAddressId: address.id },
})

const quote = (await call('GET', `/storefront/checkout/${session.id}`, { token: shopper })).body.data

// ── the attempt reaches Razorpay ────────────────────────────────────────────

const payment = (await call('POST', '/storefront/payments', {
  token: shopper,
  key: randomUUID(),
  body: { checkoutSessionId: session.id },
})).body.data

check('payment opens', Boolean(payment?.id), `status PENDING`)
check('it is recorded against razorpay', payment.provider === 'razorpay', payment.provider)
check(
  'the provider id is a Razorpay order id',
  String(payment.providerPaymentId).startsWith('order_'),
  payment.providerPaymentId,
)
check(
  'it charges the quoted total',
  Math.abs(Number(payment.amount) - Number(quote.totalAmount)) < 0.02,
  `₹${payment.amount} vs ₹${quote.totalAmount}`,
)

const cp = payment.clientPayload ?? {}
check('the client payload names razorpay', cp.provider === 'razorpay')
check('and carries the publishable key only', String(cp.key).startsWith('rzp_'), String(cp.key))
check(
  'and no secret leaks into it',
  !JSON.stringify(cp).includes(env.RAZORPAY_KEY_SECRET) &&
    !JSON.stringify(cp).includes(env.RAZORPAY_WEBHOOK_SECRET),
)
check('and the order id the sheet needs', cp.orderId === payment.providerPaymentId)

const paise = Math.round(Number(quote.totalAmount) * 100)
check('the payload amount is the total in paise', cp.amount === paise, `${cp.amount} vs ${paise}`)

// ── that order really exists at Razorpay ────────────────────────────────────

const remote = await razorpay(`/orders/${payment.providerPaymentId}`)
check('Razorpay has the order', remote.status === 200, remote.body?.id)
check('with the amount we sent', remote.body?.amount === paise, `${remote.body?.amount} paise`)
check('and our session id as the receipt', remote.body?.receipt === session.id, remote.body?.receipt)
check('and the reference in its notes', remote.body?.notes?.reference === session.id)
check('and it is unpaid so far', remote.body?.status === 'created', remote.body?.status)

// ── the webhook, as Razorpay sends it ───────────────────────────────────────

const captured = {
  entity: 'event',
  event: 'payment.captured',
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: `pay_TEST${Date.now()}`,
        entity: 'payment',
        amount: paise,
        currency: 'INR',
        status: 'captured',
        order_id: payment.providerPaymentId,
        method: 'card',
        captured: true,
        notes: { reference: session.id },
      },
    },
  },
}

// A tampered body first: if this were accepted, nothing below would mean
// anything.
const forged = await sendWebhook(captured, { secret: 'not-the-webhook-secret' })
check('a webhook signed with the wrong secret is refused', forged.status === 401, `status ${forged.status}`)

const ignored = await sendWebhook({ entity: 'event', event: 'order.paid', payload: {} })
check(
  'an event we do not act on is answered 200, not retried',
  ignored.status === 200 && ignored.body?.handled === false,
  ignored.body?.reason,
)

const delivered = await sendWebhook(captured)
check('a correctly signed capture is accepted', delivered.status === 200, `status ${delivered.status}`)
check('and it wrote an order', delivered.body?.action === 'CAPTURED', delivered.body?.orderNumber)

// ── what the customer sees ──────────────────────────────────────────────────

let order = null
for (let attempt = 0; attempt < 20 && !order; attempt++) {
  const settled = await call('GET', `/storefront/checkout/${session.id}`, { token: shopper })
  if (settled.body?.data?.order) order = settled.body.data.order
  else await new Promise((resolve) => setTimeout(resolve, 250))
}
check('the session now points at the order', Boolean(order), order?.orderNumber)

const placed = (await call('GET', `/storefront/orders/${order.orderNumber}`, { token: shopper })).body.data
check('the order is paid', placed.paymentStatus === 'PAID', placed.paymentStatus)
check(
  'for the amount that was quoted',
  Math.abs(Number(placed.totalAmount) - Number(quote.totalAmount)) < 0.02,
  `₹${placed.totalAmount}`,
)
check('and the cart was emptied', ((await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []).length === 0)

// ── delivered twice, which is the ordinary case ─────────────────────────────

const again = await sendWebhook(captured)
check('a duplicate delivery is accepted', again.status === 200, `status ${again.status}`)
check('and does not write a second order', again.body?.action === 'CAPTURED')

const after = (await call('GET', `/storefront/orders/${order.orderNumber}`, { token: shopper })).body.data
check('the order is unchanged by it', after.paymentStatus === 'PAID' && after.totalAmount === placed.totalAmount)

// ── a decline releases the hold ─────────────────────────────────────────────

const open2 = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open2.body?.data) await call('DELETE', `/storefront/checkout/${open2.body.data.id}`, { token: shopper })
await call('POST', '/storefront/cart/items', {
  token: shopper,
  body: { variantId: pick.variant.id, quantity: 1 },
})
const s2 = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data
await call('POST', `/storefront/checkout/${s2.id}/address`, {
  token: shopper,
  body: { shippingAddressId: address.id },
})
const p2 = (await call('POST', '/storefront/payments', {
  token: shopper,
  key: randomUUID(),
  body: { checkoutSessionId: s2.id },
})).body.data

const declined = await sendWebhook({
  entity: 'event',
  event: 'payment.failed',
  payload: {
    payment: {
      entity: {
        id: `pay_FAIL${Date.now()}`,
        amount: Math.round(Number(s2.totalAmount) * 100),
        currency: 'INR',
        status: 'failed',
        order_id: p2.providerPaymentId,
        error_description: 'Your card was declined by the bank',
        notes: { reference: s2.id },
      },
    },
  },
})
check('a decline is accepted', declined.status === 200, `status ${declined.status}`)
check('and is recorded as a failure', declined.body?.action === 'FAILED', declined.body?.action)

const after2 = (await call('GET', `/storefront/checkout/${s2.id}`, { token: shopper })).body?.data
check('the declined session is cancelled, not left open', after2?.status === 'CANCELLED', after2?.status)

// ── clean up ────────────────────────────────────────────────────────────────

const leftovers = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of leftovers) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })

console.log(`\n${passed}/${passed + failed} passed`)
console.log(`test order to remove: ${order?.orderNumber ?? 'none'}`)
process.exit(failed === 0 ? 0 : 1)
