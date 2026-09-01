/**
 * Order discounts: off the whole cart, with the minimum measured against the
 * whole cart too — which is the one thing that makes them different from a
 * product discount covering every product.
 *
 * The interesting case is the two kinds together: a product discount takes its
 * lines first, and the order discount is worked out on what is still owed. The
 * same rupee is never discounted twice.
 */
const API = 'http://localhost:4000/api'

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  ok ? passed++ : failed++
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

const listing = await call('GET', '/storefront/products?limit=16', { token: shopper })
const picks = []
for (const card of listing.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token: shopper })
  const variant = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (variant) picks.push({ productId: full.body.data.id, variantId: variant.id, price: Number(variant.price) })
  if (picks.length === 2) break
}
const [a, b] = picks
const cartTotal = a.price + b.price

const stamp = Math.floor(Math.random() * 9000 + 1000)
const code = (suffix) => `ORD${stamp}${suffix}`
const made = []
const yesterday = new Date(Date.now() - 86_400_000).toISOString()

const makeDiscount = async (body) => {
  const res = await call('POST', '/admin/discounts', {
    token: admin,
    body: { type: 'PERCENT', value: 10, startsAt: yesterday, ...body },
  })
  if (res.status !== 201) {
    console.error('fixture failed', res.status, JSON.stringify(res.body))
    process.exit(1)
  }
  made.push(res.body.data)
  return res.body.data
}

// ── an order discount needs no products ────────────────────────────────────
const tenOffOrder = await makeDiscount({
  code: code('TEN'),
  kind: 'ORDER',
  value: 10,
  combinesWithProduct: true,
  combinesWithOrder: true,
})
check(
  'an order discount is created with no products at all',
  tenOffOrder.appliesTo === null &&
    tenOffOrder.products.length === 0 &&
    tenOffOrder.collections.length === 0,
)

// the same request as a product discount is refused for having no targets
const missing = await call('POST', '/admin/discounts', {
  token: admin,
  body: { code: code('BAD'), kind: 'PRODUCT', type: 'PERCENT', value: 10, startsAt: yesterday },
})
check(
  'while a product discount still has to name something',
  missing.status === 400 && Boolean(missing.body?.error?.fields?.appliesTo),
  `${missing.status} ${missing.body?.error?.fields?.appliesTo}`,
)

// a minimum the whole cart clears but one product would not
const overCart = await makeDiscount({
  code: code('MIN'),
  kind: 'ORDER',
  type: 'FIXED',
  value: 200,
  minRequirement: 'PURCHASE_AMOUNT',
  minCartValue: Math.round(cartTotal - 50),
  combinesWithOrder: true,
  combinesWithProduct: true,
})
// and one it does not
await makeDiscount({
  code: code('HIGH'),
  kind: 'ORDER',
  type: 'FIXED',
  value: 200,
  minRequirement: 'PURCHASE_AMOUNT',
  minCartValue: Math.round(cartTotal + 5000),
  combinesWithOrder: true,
  combinesWithProduct: true,
})
// a product discount on the dearer item, to stack against
const dearest = a.price >= b.price ? a : b
await makeDiscount({
  code: code('ITEM'),
  kind: 'PRODUCT',
  value: 50,
  appliesTo: 'PRODUCTS',
  productIds: [dearest.productId],
  combinesWithOrder: true,
  combinesWithProduct: true,
})
// an order discount that refuses product discounts
await makeDiscount({
  code: code('SOLO'),
  kind: 'ORDER',
  value: 5,
  combinesWithOrder: false,
  combinesWithProduct: false,
})

// ── a cart with both items ─────────────────────────────────────────────────
const priorCart = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of priorCart) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
const open = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token: shopper })
for (const pick of picks) {
  await call('POST', '/storefront/cart/items', { token: shopper, body: { variantId: pick.variantId, quantity: 1 } })
}
const session = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data
const id = session.id
const tryCode = (value) => call('POST', `/storefront/checkout/${id}/coupons`, { token: shopper, body: { code: value } })
const drop = (couponId) => call('DELETE', `/storefront/checkout/${id}/coupons/${couponId}`, { token: shopper })

// ── 10% off the cart ───────────────────────────────────────────────────────
const applied = await tryCode(code('TEN'))
check('an order discount applies', applied.status === 200, `status ${applied.status}`)
const withOrder = applied.body.data
check(
  'it is worth a tenth of the whole cart',
  near(withOrder.totalDiscount, Math.floor(cartTotal * 10) / 100),
  `₹${withOrder.totalDiscount} of ₹${cartTotal}`,
)
check(
  'no line carries a code — an order discount has no line to sit on',
  withOrder.items.every((item) => item.discount === null),
)
check(
  'the subtotal is untouched, and the saving gets its own row',
  near(withOrder.goodsTotal, cartTotal) &&
    withOrder.discounts[0].kind === 'ORDER' &&
    near(withOrder.discounts[0].amount, withOrder.totalDiscount),
  `subtotal ₹${withOrder.goodsTotal}`,
)
check(
  'and the total is the cart less the discount plus shipping',
  near(
    Number(withOrder.totalAmount),
    cartTotal - Number(withOrder.totalDiscount) + Number(withOrder.shippingAmount),
  ),
  `₹${withOrder.totalAmount}`,
)

// ── the minimum is the whole cart, not one product ─────────────────────────
await drop(withOrder.discounts[0].couponId)
const clears = await tryCode(code('MIN'))
check(
  'a minimum only the whole cart clears is accepted',
  clears.status === 200,
  `min ₹${Math.round(cartTotal - 50)} against a ₹${cartTotal} cart`,
)
await drop(clears.body.data.discounts[0].couponId)

const tooHigh = await tryCode(code('HIGH'))
check(
  'and one the cart cannot reach is refused, against the cart',
  tooHigh.status === 422 && /Your bag comes to/.test(tooHigh.body?.error?.reason ?? ''),
  `${tooHigh.body?.error?.message} — ${tooHigh.body?.error?.reason}`,
)

// ── the two kinds together ─────────────────────────────────────────────────
const itemFirst = await tryCode(code('ITEM'))
check('a product discount applies alongside', itemFirst.status === 200)
const both = (await tryCode(code('TEN'))).body.data
check('both codes are held', both.discounts.length === 2)

const itemSaving = Math.floor(dearest.price * 50) / 100
const remaining = cartTotal - itemSaving
const orderSaving = Math.floor(remaining * 10) / 100
check(
  'the product discount takes its line',
  near(both.discounts.find((d) => d.code === code('ITEM')).amount, itemSaving),
  `₹${both.discounts.find((d) => d.code === code('ITEM')).amount} vs ₹${itemSaving.toFixed(2)}`,
)
check(
  'and the order discount is worked out on what is still owed',
  near(both.discounts.find((d) => d.code === code('TEN')).amount, orderSaving),
  `₹${both.discounts.find((d) => d.code === code('TEN')).amount} vs ₹${orderSaving.toFixed(2)}`,
)
check(
  'so the same rupee is never discounted twice',
  near(both.totalDiscount, itemSaving + orderSaving),
  `₹${both.totalDiscount}`,
)
check(
  'the subtotal shows the lines after their own discount only',
  near(both.goodsTotal, cartTotal - itemSaving),
  `₹${both.goodsTotal}`,
)
check(
  'and the total still adds up',
  near(
    Number(both.totalAmount),
    Number(both.goodsTotal) - orderSaving + Number(both.shippingAmount),
  ),
  `${both.goodsTotal} − ${orderSaving.toFixed(2)} + ${both.shippingAmount} = ${both.totalAmount}`,
)

// ── combinations across kinds ──────────────────────────────────────────────
const refused = await tryCode(code('SOLO'))
check(
  'an order discount that refuses product discounts is blocked by one',
  refused.status === 409 && refused.body?.error?.code === 'COUPON_NOT_COMBINABLE',
  refused.body?.error?.message,
)

console.log(`\n${passed}/${passed + failed} passed`)
console.log(`codes to remove: ${made.map((d) => d.code).join(', ')}`)
process.exit(failed ? 1 : 0)
