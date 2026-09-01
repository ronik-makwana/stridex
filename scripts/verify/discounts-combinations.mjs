/**
 * Combinations are read from the code being applied, at the moment it is
 * applied.
 *
 * The case this exists for: an operator changes a discount's combinations in
 * the admin, and the very next attempt at checkout has to use what they just
 * saved — not what anything was set to when an earlier code was applied.
 */
const API = 'http://localhost:4000/api'

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  ok ? passed++ : failed++
}

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

const listing = await call('GET', '/storefront/products?limit=8', { token: shopper })
let pick = null
for (const card of listing.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token: shopper })
  const variant = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (variant) {
    pick = { productId: full.body.data.id, variantId: variant.id }
    break
  }
}

const stamp = Math.floor(Math.random() * 9000 + 1000)
const code = (suffix) => `CMB${stamp}${suffix}`
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

/** The one already on the checkout. It refuses everything, and that is fine. */
const held = await makeDiscount({
  code: code('HELD'),
  kind: 'ORDER',
  value: 10,
  combinesWithProduct: false,
  combinesWithOrder: false,
})

/** The one being applied. Starts refusing order discounts. */
const arriving = await makeDiscount({
  code: code('NEW'),
  kind: 'PRODUCT',
  value: 20,
  appliesTo: 'PRODUCTS',
  productIds: [pick.productId],
  combinesWithOrder: false,
  combinesWithProduct: true,
})

const priorCart = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of priorCart) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
const open = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token: shopper })
await call('POST', '/storefront/cart/items', { token: shopper, body: { variantId: pick.variantId, quantity: 1 } })

const session = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data
const tryCode = (value) =>
  call('POST', `/storefront/checkout/${session.id}/coupons`, { token: shopper, body: { code: value } })

const first = await tryCode(code('HELD'))
check('the first code applies', first.status === 200, `status ${first.status}`)

const refused = await tryCode(code('NEW'))
check(
  'a code that refuses order discounts is blocked by one',
  refused.status === 409 && refused.body?.error?.code === 'COUPON_NOT_COMBINABLE',
  refused.body?.error?.message,
)

// ── the operator changes their mind, in the admin ──────────────────────────
const editArriving = {
  code: code('NEW'),
  kind: 'PRODUCT',
  type: 'PERCENT',
  value: 20,
  appliesTo: 'PRODUCTS',
  productIds: [pick.productId],
  startsAt: yesterday,
  combinesWithOrder: true,
  combinesWithProduct: true,
}
const saved = await call('PUT', `/admin/discounts/${arriving.id}`, { token: admin, body: editArriving })
check('the admin saves the new combination', saved.status === 200 && saved.body.data.combinesWithOrder)

const nowAllowed = await tryCode(code('NEW'))
check(
  'and the very next attempt uses it — no restart, no re-apply',
  nowAllowed.status === 200,
  `status ${nowAllowed.status} ${nowAllowed.body?.error?.message ?? ''}`,
)
check(
  'the held code is untouched by that decision',
  nowAllowed.body?.data?.discounts?.length === 2,
  `${nowAllowed.body?.data?.discounts?.length} codes on the checkout`,
)

// ── and it is the arriving code that decides, not the held one ─────────────
await call(
  'DELETE',
  `/storefront/checkout/${session.id}/coupons/${arriving.id}`,
  { token: shopper },
)
const turnedOff = await call('PUT', `/admin/discounts/${arriving.id}`, {
  token: admin,
  body: { ...editArriving, combinesWithOrder: false },
})
check('the operator turns it off again', turnedOff.status === 200)

const blockedAgain = await tryCode(code('NEW'))
check(
  'and it is refused again immediately',
  blockedAgain.status === 409,
  blockedAgain.body?.error?.message,
)

console.log(`\n${passed}/${passed + failed} passed`)
console.log(`codes to remove: ${made.map((d) => d.code).join(', ')}`)
process.exit(failed ? 1 : 0)
