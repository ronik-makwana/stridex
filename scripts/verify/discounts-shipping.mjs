/**
 * Shipping discounts: money off the delivery charge, with an exclusion for the
 * rates the merchant does not want to subsidise.
 *
 * Two things make this kind different from the other two, and both are proved
 * here: it is worked out *after* the delivery rate is known, and only one of
 * them can ever apply to one checkout.
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

// A cheap enough item that standard delivery is charged rather than free.
const listing = await call('GET', '/storefront/products?limit=24', { token: shopper })
let pick = null
for (const card of listing.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token: shopper })
  const variant = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (variant && Number(variant.price) < 1500) {
    pick = { productId: full.body.data.id, variantId: variant.id, price: Number(variant.price) }
    break
  }
}

const stamp = Math.floor(Math.random() * 9000 + 1000)
const code = (suffix) => `SHP${stamp}${suffix}`
const made = []
const yesterday = new Date(Date.now() - 86_400_000).toISOString()

const makeDiscount = async (body) => {
  const res = await call('POST', '/admin/discounts', {
    token: admin,
    body: { type: 'PERCENT', value: 100, startsAt: yesterday, ...body },
  })
  if (res.status !== 201) {
    console.error('fixture failed', res.status, JSON.stringify(res.body))
    process.exit(1)
  }
  made.push(res.body.data)
  return res.body.data
}

const free = await makeDiscount({
  code: code('FREE'),
  kind: 'SHIPPING',
  value: 100,
  combinesWithProduct: true,
  combinesWithOrder: true,
})
check(
  'a shipping discount needs no products and no rate cap',
  free.kind === 'SHIPPING' && free.appliesTo === null && free.maxShippingAmount === null,
)

// Standard is ₹99, express ₹249 — this one covers the slow van only.
const cheapOnly = await makeDiscount({
  code: code('SLOW'),
  kind: 'SHIPPING',
  value: 100,
  maxShippingAmount: 150,
  combinesWithProduct: true,
  combinesWithOrder: true,
})
check('the exclusion is stored', Number(cheapOnly.maxShippingAmount) === 150, cheapOnly.maxShippingAmount)

const halfOff = await makeDiscount({
  code: code('HALF'),
  kind: 'SHIPPING',
  value: 50,
  combinesWithProduct: true,
  combinesWithOrder: true,
})
await makeDiscount({
  code: code('ITEM'),
  kind: 'PRODUCT',
  value: 10,
  appliesTo: 'PRODUCTS',
  productIds: [pick.productId],
  combinesWithProduct: true,
  combinesWithOrder: true,
  combinesWithShipping: true,
})

// only a shipping discount may carry a rate cap
const wrongKind = await call('POST', '/admin/discounts', {
  token: admin,
  body: {
    code: code('BAD'),
    kind: 'ORDER',
    type: 'PERCENT',
    value: 10,
    startsAt: yesterday,
    maxShippingAmount: 100,
  },
})
check(
  'an order discount cannot exclude shipping rates',
  wrongKind.status === 400 && Boolean(wrongKind.body?.error?.fields?.maxShippingAmount),
  wrongKind.body?.error?.fields?.maxShippingAmount,
)

// ── a checkout paying for delivery ─────────────────────────────────────────
const priorCart = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of priorCart) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
const open = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token: shopper })
await call('POST', '/storefront/cart/items', { token: shopper, body: { variantId: pick.variantId, quantity: 1 } })

const session = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data
const id = session.id
const tryCode = (value) => call('POST', `/storefront/checkout/${id}/coupons`, { token: shopper, body: { code: value } })
const drop = (couponId) => call('DELETE', `/storefront/checkout/${id}/coupons/${couponId}`, { token: shopper })
const setMethod = (method) => call('POST', `/storefront/checkout/${id}/shipping-method`, { token: shopper, body: { method } })

const standardRate = Number(session.shippingAmount)
check('delivery is being charged on this cart', standardRate > 0, `₹${standardRate}`)

// ── 100% off delivery ──────────────────────────────────────────────────────
const applied = await tryCode(code('FREE'))
check('a shipping discount applies', applied.status === 200, `status ${applied.status}`)
const withFree = applied.body.data
check(
  'the rate is still shown, and the saving sits beside it',
  near(withFree.shippingAmount, standardRate) && near(withFree.shippingDiscount, standardRate),
  `rate ₹${withFree.shippingAmount}, off ₹${withFree.shippingDiscount}`,
)
check(
  'the total pays for the goods and nothing for delivery',
  near(withFree.totalAmount, withFree.goodsTotal),
  `₹${withFree.totalAmount} vs goods ₹${withFree.goodsTotal}`,
)
check('and no goods discount was invented', near(withFree.goodsTotal, session.subtotal))

// ── it follows the rate when the customer changes speed ────────────────────
const express = await setMethod('EXPRESS')
const expressRate = Number(express.body.data.shippingAmount)
check(
  'switching to express re-prices the discount against the new rate',
  expressRate > standardRate && near(express.body.data.shippingDiscount, expressRate),
  `₹${expressRate} off ₹${expressRate}`,
)
await setMethod('STANDARD')
await drop(withFree.discounts[0].couponId)

// ── the exclusion ──────────────────────────────────────────────────────────
const cheapApplied = await tryCode(code('SLOW'))
check('a capped code applies to a rate under the cap', cheapApplied.status === 200)

const switched = await setMethod('EXPRESS')
check(
  'and is dropped when the customer picks a dearer service',
  switched.body.data.discounts.length === 0 && Number(switched.body.data.shippingDiscount) === 0,
  `${switched.body.data.discounts.length} codes, ₹${switched.body.data.shippingDiscount} off`,
)

const refused = await tryCode(code('SLOW'))
check(
  'applying it on the dearer service is refused, with both figures',
  refused.status === 422 &&
    refused.body?.error?.code === 'COUPON_SHIPPING_EXCLUDED' &&
    /150/.test(refused.body?.error?.reason ?? ''),
  `${refused.body?.error?.message} — ${refused.body?.error?.reason}`,
)
await setMethod('STANDARD')

// ── one delivery discount at a time ────────────────────────────────────────
const first = await tryCode(code('FREE'))
check('the first delivery code applies', first.status === 200)
const second = await tryCode(code('HALF'))
check(
  'a second delivery code is refused whatever the ticks say',
  second.status === 409 && /Only one delivery discount/.test(second.body?.error?.reason ?? ''),
  second.body?.error?.reason,
)

// ── but it sits happily beside a product discount ──────────────────────────
const alongside = await tryCode(code('ITEM'))
check('a product discount still applies alongside it', alongside.status === 200, `status ${alongside.status}`)
const both = alongside.body.data
const itemSaving = Math.floor(pick.price * 10) / 100
check(
  'the goods are discounted and the delivery is free',
  near(both.goodsTotal, pick.price - itemSaving) && near(both.shippingDiscount, standardRate),
  `goods ₹${both.goodsTotal}, delivery −₹${both.shippingDiscount}`,
)
check(
  'and the total is goods plus rate less both savings',
  near(both.totalAmount, Number(both.goodsTotal) + standardRate - Number(both.shippingDiscount)),
  `₹${both.totalAmount}`,
)
check(
  'every saving is counted once in the headline figure',
  near(both.totalDiscount, itemSaving + standardRate),
  `₹${both.totalDiscount}`,
)

console.log(`\n${passed}/${passed + failed} passed`)
console.log(`codes to remove: ${made.map((d) => d.code).join(', ')}`)
process.exit(failed ? 1 : 0)
