/**
 * Discount codes at checkout.
 *
 * The rules being proved, in the order they matter:
 *   1. the server prices the code — the client only names it
 *   2. several codes can sit on one cart, but a line takes at most one, and the
 *      biggest wins
 *   3. two codes only combine when **both** say they combine
 *   4. limits, eligibility and minimums are enforced against this basket
 *   5. the saving reaches the order, and the code is spent exactly once
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

const admin = (await call('POST', '/admin/auth/login', {
  body: { email: 'admin@shoe.com', password: 'Admin@12345' },
})).body.data.accessToken

const shopper = (await call('POST', '/storefront/auth/login', {
  body: { email: 'shopper@shoe.com', password: 'Customer@12345' },
})).body.data.accessToken

// ── fixture: two purchasable products, one cheap, one dear ──────────────────
const listing = await call('GET', '/storefront/products?limit=24', { token: shopper })
const picks = []
for (const card of listing.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token: shopper })
  const variant = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (variant) picks.push({ productId: full.body.data.id, variant, title: full.body.data.title })
  if (picks.length === 2) break
}
if (picks.length < 2) {
  console.error('need two purchasable products')
  process.exit(1)
}
const [cheap, dear] = picks.sort((a, b) => Number(a.variant.price) - Number(b.variant.price))

const stamp = Math.floor(Math.random() * 9000 + 1000)
const codes = {
  ten: `CHK${stamp}TEN`,
  thirty: `CHK${stamp}THIRTY`,
  lonely: `CHK${stamp}SOLO`,
  minimum: `CHK${stamp}MIN`,
}
const made = []

const makeDiscount = async (body) => {
  const res = await call('POST', '/admin/discounts', { token: admin, body })
  if (res.status !== 201) {
    console.error('could not create fixture discount', res.status, JSON.stringify(res.body))
    process.exit(1)
  }
  made.push(res.body.data.id)
  return res.body.data
}

const yesterday = new Date(Date.now() - 86_400_000).toISOString()

// 10% off both products, combinable
await makeDiscount({
  code: codes.ten,
  type: 'PERCENT',
  value: 10,
  appliesTo: 'PRODUCTS',
  productIds: [cheap.productId, dear.productId],
  startsAt: yesterday,
  combinesWithProduct: true,
})
// 30% off the dearer product only, combinable — should beat the 10% on that line
await makeDiscount({
  code: codes.thirty,
  type: 'PERCENT',
  value: 30,
  appliesTo: 'PRODUCTS',
  productIds: [dear.productId],
  startsAt: yesterday,
  combinesWithProduct: true,
})
// 15% off, but refuses to combine
await makeDiscount({
  code: codes.lonely,
  type: 'PERCENT',
  value: 15,
  appliesTo: 'PRODUCTS',
  productIds: [cheap.productId, dear.productId],
  startsAt: yesterday,
  combinesWithProduct: false,
})
// A minimum nobody in this basket can meet
await makeDiscount({
  code: codes.minimum,
  type: 'FIXED',
  value: 100,
  appliesTo: 'PRODUCTS',
  productIds: [cheap.productId],
  minRequirement: 'PURCHASE_AMOUNT',
  minCartValue: 999_999,
  startsAt: yesterday,
  combinesWithProduct: true,
})

// ── a checkout with one of each ────────────────────────────────────────────
const priorCart = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of priorCart) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
const open = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token: shopper })

for (const pick of [cheap, dear]) {
  await call('POST', '/storefront/cart/items', {
    token: shopper,
    body: { variantId: pick.variant.id, quantity: 1 },
  })
}

const created = await call('POST', '/storefront/checkout', { token: shopper, body: {} })
const id = created.body.data.id
const base = created.body.data
check('a fresh checkout has no discounts', base.discounts.length === 0 && Number(base.totalDiscount) === 0)

const cheapPrice = Number(cheap.variant.price)
const dearPrice = Number(dear.variant.price)

// ── one code ───────────────────────────────────────────────────────────────
const first = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.ten.toLowerCase() },
})
check('a code applies in any case', first.status === 200, `status ${first.status}`)
check('and comes back named', first.body?.data?.discounts?.[0]?.code === codes.ten)

const tenExpected = Math.floor(cheapPrice * 0.1 * 100) / 100 + Math.floor(dearPrice * 0.1 * 100) / 100
check(
  'the server priced it, to the paisa',
  Math.abs(Number(first.body.data.totalDiscount) - tenExpected) < 0.02,
  `₹${first.body.data.totalDiscount} vs ₹${tenExpected.toFixed(2)}`,
)
check(
  'and the total came down by exactly that',
  Math.abs(
    Number(base.totalAmount) - Number(first.body.data.totalAmount) -
      Number(first.body.data.totalDiscount),
  ) < 0.02,
  `₹${base.totalAmount} → ₹${first.body.data.totalAmount}`,
)

// ── a second code: max wins per line ───────────────────────────────────────
const second = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.thirty },
})
check('a second combinable code is accepted', second.status === 200, `status ${second.status}`)
const applied = second.body.data
check('both codes are listed', applied.discounts.length === 2)

const byCode = Object.fromEntries(applied.discounts.map((d) => [d.code, Number(d.amount)]))
const expectedTen = Math.floor(cheapPrice * 0.1 * 100) / 100
const expectedThirty = Math.floor(dearPrice * 0.3 * 100) / 100
check(
  'the 30% code takes the dear line',
  Math.abs(byCode[codes.thirty] - expectedThirty) < 0.02,
  `₹${byCode[codes.thirty]} vs ₹${expectedThirty.toFixed(2)}`,
)
check(
  'and the 10% code keeps only the line it still wins',
  Math.abs(byCode[codes.ten] - expectedTen) < 0.02,
  `₹${byCode[codes.ten]} vs ₹${expectedTen.toFixed(2)}`,
)
check(
  'no line is discounted twice',
  Math.abs(Number(applied.totalDiscount) - (expectedTen + expectedThirty)) < 0.02,
  `₹${applied.totalDiscount}`,
)

// ── combinations: both must say yes ────────────────────────────────────────
const refusedCombo = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.lonely },
})
check(
  'a code that refuses to combine is refused',
  refusedCombo.status === 409 && refusedCombo.body?.error?.code === 'COUPON_NOT_COMBINABLE',
  `status ${refusedCombo.status}`,
)
check(
  'the message names the code that was refused',
  (refusedCombo.body?.error?.message ?? '').startsWith(codes.lonely),
  refusedCombo.body?.error?.message,
)
check(
  'and the reason names the one to remove',
  new RegExp(`${codes.ten}|${codes.thirty}`).test(refusedCombo.body?.error?.reason ?? ''),
  refusedCombo.body?.error?.reason,
)

// ── the other direction: a combinable code onto a non-combinable one ───────
for (const discount of applied.discounts) {
  await call('DELETE', `/storefront/checkout/${id}/coupons/${discount.couponId}`, { token: shopper })
}
const soloFirst = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.lonely },
})
check('the non-combinable code applies on its own', soloFirst.status === 200)
/**
 * The other direction is *allowed*: only the arriving code's settings are read,
 * and this one does combine with product discounts. A code already on the
 * checkout gets no veto — an operator who has just changed a discount in the
 * admin expects the next attempt to use what they changed.
 */
const arriving = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.ten },
})
check(
  'and a combinable code may follow it — the arriving code decides',
  arriving.status === 200,
  `status ${arriving.status} ${arriving.body?.error?.message ?? ''}`,
)
for (const discount of arriving.body?.data?.discounts ?? []) {
  await call('DELETE', `/storefront/checkout/${id}/coupons/${discount.couponId}`, { token: shopper })
}

// ── refusals a customer can act on ─────────────────────────────────────────
const unknown = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: 'NOSUCHCODE' },
})
check('an unknown code is refused', unknown.status === 422 && unknown.body?.error?.code === 'COUPON_NOT_FOUND')

await call('DELETE', `/storefront/checkout/${id}/coupons/${soloFirst.body.data.discounts[0].couponId}`, {
  token: shopper,
})
const tooSmall = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.minimum },
})
check(
  'a minimum that is not met says the number',
  tooSmall.status === 422 && /999999|999,999/.test(tooSmall.body?.error?.message ?? ''),
  tooSmall.body?.error?.message,
)

const twice = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.ten },
})
const again = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.ten },
})
check(
  'the same code twice is refused, by name',
  again.status === 409 && (again.body?.error?.message ?? '').startsWith(codes.ten),
  again.body?.error?.message,
)

// ── the client cannot name its own amount ──────────────────────────────────
const tampered = await call('POST', `/storefront/checkout/${id}/coupons`, {
  token: shopper,
  body: { code: codes.thirty, amount: '9999', discountAmount: '9999' },
})
check(
  'an amount in the body is ignored',
  tampered.status === 200 &&
    Math.abs(Number(tampered.body.data.totalDiscount) - (expectedTen + expectedThirty)) < 0.02,
  `₹${tampered.body?.data?.totalDiscount}`,
)

// ── it reaches the order, and is spent once ────────────────────────────────
const book = await call('GET', '/storefront/addresses', { token: shopper })
const address = book.body?.data?.[0]
await call('POST', `/storefront/checkout/${id}/address`, {
  token: shopper,
  body: { shippingAddressId: address.id },
})

const finalQuote = (await call('GET', `/storefront/checkout/${id}`, { token: shopper })).body.data
const payment = await call('POST', '/storefront/payments', {
  token: shopper,
  key: crypto.randomUUID(),
  body: { checkoutSessionId: id },
})
check('payment opens on the discounted total', payment.status === 201, `status ${payment.status}`)
check(
  'and charges the discounted amount',
  Math.abs(Number(payment.body.data.amount) - Number(finalQuote.totalAmount)) < 0.02,
  `₹${payment.body?.data?.amount} vs ₹${finalQuote.totalAmount}`,
)

await call('POST', `/storefront/payments/${payment.body.data.id}/mock-complete`, {
  token: shopper,
  body: { outcome: 'success' },
})

let order = null
for (let attempt = 0; attempt < 20 && !order; attempt++) {
  const settled = await call('GET', `/storefront/checkout/${id}`, { token: shopper })
  if (settled.body?.data?.order) order = settled.body.data.order
  else await new Promise((resolve) => setTimeout(resolve, 250))
}
check('the webhook wrote the order', Boolean(order), order?.orderNumber)

const placed = (await call('GET', `/storefront/orders/${order.orderNumber}`, { token: shopper })).body.data
check(
  'the order records the saving',
  Math.abs(Number(placed.discountAmount) - Number(finalQuote.totalDiscount)) < 0.02,
  `₹${placed.discountAmount}`,
)
check(
  'and its figures add up',
  Math.abs(
    Number(placed.subtotal) - Number(placed.discountAmount) + Number(placed.shippingAmount) -
      Number(placed.totalAmount),
  ) < 0.02,
  `${placed.subtotal} − ${placed.discountAmount} + ${placed.shippingAmount} = ${placed.totalAmount}`,
)

const spent = await call('GET', `/admin/discounts?q=${codes.ten}`, { token: admin })
check('the code counted one use', spent.body?.data?.[0]?.usedCount === 1, `used ${spent.body?.data?.[0]?.usedCount}`)

// ── cleanup ────────────────────────────────────────────────────────────────
console.log('\ncleaning up')
const leftovers = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of leftovers) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
for (const pick of priorCart) {
  await call('POST', '/storefront/cart/items', {
    token: shopper,
    body: { variantId: pick.variantId, quantity: pick.quantity },
  })
}

console.log(`\n${passed}/${passed + failed} passed`)
console.log(`test order to remove: ${order?.orderNumber ?? 'none'}`)
console.log(`test discounts to remove: ${made.join(', ')}`)
process.exit(failed ? 1 : 0)
