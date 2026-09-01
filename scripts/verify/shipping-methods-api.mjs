/**
 * The shipping method, end to end and against the money.
 *
 * The one thing this has to prove is that the *server* prices the choice: the
 * client sends a code, the total moves by exactly the quoted rate, and a code
 * that is not on the list is refused rather than trusted (§21).
 */
const API = 'http://localhost:4000/api'

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

const login = await call('POST', '/storefront/auth/login', {
  body: { email: 'shopper@shoe.com', password: 'Customer@12345' },
})
if (login.status !== 200) {
  console.error('cannot log in as the fixture shopper', login.status, login.body)
  process.exit(1)
}
const token = login.body.data.accessToken

// Leave whatever was there alone: note the cart, and put it back at the end.
const before = await call('GET', '/storefront/cart', { token })
const restore = before.body?.data?.items ?? []

// A purchasable variant, cheap enough to stay under the free-delivery threshold.
const list = await call('GET', '/storefront/products?limit=24', { token })
let variant = null
for (const card of list.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token })
  const found = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (found && Number(found.price) < 1500) {
    variant = found
    break
  }
}
if (!variant) {
  console.error('no purchasable variant under the free-delivery threshold')
  process.exit(1)
}

// Clear, then one line, so the arithmetic below is about one known price.
for (const item of restore) await call('DELETE', `/storefront/cart/items/${item.id}`, { token })
await call('POST', '/storefront/cart/items', {
  token,
  body: { variantId: variant.id, quantity: 1 },
})

const active = await call('GET', '/storefront/checkout/active', { token })
if (active.body?.data) await call('DELETE', `/storefront/checkout/${active.body.data.id}`, { token })

const created = await call('POST', '/storefront/checkout', { token, body: {} })
check('checkout opens', created.status === 201, `status ${created.status}`)
const id = created.body?.data?.id
if (!id) process.exit(1)

const session = created.body.data
const methods = session.shippingMethods ?? []

check('three services are offered', methods.length === 3, methods.map((m) => m.code).join(', '))
check('standard is the default', session.shippingMethod === 'STANDARD', session.shippingMethod)
check(
  'every service is priced by the server',
  methods.every((m) => typeof m.amount === 'string' && m.label && m.eta),
)

const rateOf = (code) => Number(methods.find((m) => m.code === code)?.amount ?? NaN)
check(
  'the paid services cost more than standard',
  rateOf('EXPRESS') > rateOf('STANDARD') && rateOf('PRIORITY') > rateOf('EXPRESS'),
  `standard ₹${rateOf('STANDARD')}, express ₹${rateOf('EXPRESS')}, priority ₹${rateOf('PRIORITY')}`,
)
check(
  'the quote charges the standard rate it advertises',
  Number(session.shippingAmount) === rateOf('STANDARD'),
  `charged ₹${session.shippingAmount}`,
)

// ── the point of the whole exercise: the total follows the choice ────────────
const express = await call('POST', `/storefront/checkout/${id}/shipping-method`, {
  token,
  body: { method: 'EXPRESS' },
})
check('express is accepted', express.status === 200, `status ${express.status}`)
const now = express.body?.data
check('the session remembers the choice', now?.shippingMethod === 'EXPRESS', now?.shippingMethod)
check(
  'shipping is re-quoted at the express rate',
  Number(now.shippingAmount) === rateOf('EXPRESS'),
  `₹${now?.shippingAmount}`,
)
check(
  'the total moved by exactly the difference',
  Number(now.totalAmount) - Number(session.totalAmount) ===
    rateOf('EXPRESS') - rateOf('STANDARD'),
  `₹${session.totalAmount} → ₹${now.totalAmount}`,
)
check(
  'the goods were not touched',
  Number(now.subtotal) === Number(session.subtotal),
  `₹${now.subtotal}`,
)

// ── and the client cannot name its own price ─────────────────────────────────
const invented = await call('POST', `/storefront/checkout/${id}/shipping-method`, {
  token,
  body: { method: 'FREE_PRIORITY' },
})
check('an invented service is refused', invented.status === 400, `status ${invented.status}`)

const priced = await call('POST', `/storefront/checkout/${id}/shipping-method`, {
  token,
  body: { method: 'PRIORITY', amount: '0.00' },
})
check(
  'an amount in the body is ignored, not honoured',
  priced.status === 200 && Number(priced.body.data.shippingAmount) === rateOf('PRIORITY'),
  `charged ₹${priced.body?.data?.shippingAmount}`,
)

// ── it survives a refresh, and it reaches the order ──────────────────────────
const reread = await call('GET', `/storefront/checkout/${id}`, { token })
check(
  'the choice survives a refresh',
  reread.body?.data?.shippingMethod === 'PRIORITY',
  reread.body?.data?.shippingMethod,
)

// Paying needs somewhere to send it. Reuse a saved address if the fixture has
// one, so this script does not leave address rows behind either.
const book = await call('GET', '/storefront/addresses', { token })
let address = book.body?.data?.[0] ?? null
let addressWasCreated = false
if (!address) {
  const made = await call('POST', '/storefront/addresses', {
    token,
    body: {
      fullName: 'Sam Shopper',
      phone: '9876543210',
      addressLine1: '12 Test Lane',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      postalCode: '400058',
      isDefault: true,
    },
  })
  address = made.body?.data
  addressWasCreated = true
}
await call('POST', `/storefront/checkout/${id}/address`, {
  token,
  body: { shippingAddressId: address.id },
})

// The address re-quoted the session; the method must have survived it.
const afterAddress = await call('GET', `/storefront/checkout/${id}`, { token })
check(
  'setting an address does not reset the service',
  afterAddress.body?.data?.shippingMethod === 'PRIORITY' &&
    Number(afterAddress.body.data.shippingAmount) === rateOf('PRIORITY'),
  `${afterAddress.body?.data?.shippingMethod} at ₹${afterAddress.body?.data?.shippingAmount}`,
)

const payment = await call('POST', '/storefront/payments', {
  token,
  key: crypto.randomUUID(),
  body: { checkoutSessionId: id },
})
check('payment opens', payment.status === 201, `status ${payment.status}`)
await call('POST', `/storefront/payments/${payment.body.data.id}/mock-complete`, {
  token,
  body: { outcome: 'success' },
})

let order = null
for (let attempt = 0; attempt < 20 && !order; attempt++) {
  const settled = await call('GET', `/storefront/checkout/${id}`, { token })
  if (settled.body?.data?.order) order = settled.body.data.order
  else await new Promise((resolve) => setTimeout(resolve, 250))
}
check('the webhook wrote the order', Boolean(order), order?.orderNumber ?? 'never arrived')

if (order) {
  const placed = await call('GET', `/storefront/orders/${order.orderNumber}`, { token })
  check(
    'the order records the service that was paid for',
    placed.body?.data?.shippingMethod === 'Priority',
    placed.body?.data?.shippingMethod,
  )
  check(
    'and the charge that went with it',
    Number(placed.body?.data?.shippingAmount) === rateOf('PRIORITY'),
    `₹${placed.body?.data?.shippingAmount}`,
  )
}

// ── put the fixture's cart back ──────────────────────────────────────────────
const leftovers = await call('GET', '/storefront/cart', { token })
for (const item of leftovers.body?.data?.items ?? []) {
  await call('DELETE', `/storefront/cart/items/${item.id}`, { token })
}
for (const item of restore) {
  await call('POST', '/storefront/cart/items', {
    token,
    body: { variantId: item.variantId, quantity: item.quantity },
  })
}

if (addressWasCreated && address?.id) {
  await call('DELETE', `/storefront/addresses/${address.id}`, { token })
}

console.log(`\n${passed}/${passed + failed} passed`)
if (order) console.log(`test order left behind: ${order.orderNumber} (cleaned up separately)`)
process.exit(failed ? 1 : 0)
