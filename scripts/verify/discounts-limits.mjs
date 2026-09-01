/**
 * The gates on a discount code, each proved against a real checkout:
 *
 *   · eligibility — a code for named customers, tried by somebody else
 *   · minimum purchase amount, and minimum quantity
 *   · total usage limit, after the code has actually been spent
 *   · one use per customer, likewise
 *   · a code whose end date has passed, and one whose start has not arrived
 *
 * The two limits are the reason this script places an order: counting held and
 * consumed redemptions is the whole mechanism, and a test that never completes
 * a checkout would never exercise it.
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

const me = (await call('GET', '/storefront/auth/me', { token: shopper })).body?.data
const customers = (await call('GET', '/admin/customers?limit=20', { token: admin })).body.data
const someoneElse = customers.find((customer) => customer.id !== me?.id)
if (!someoneElse) {
  console.error('need a second customer account to test eligibility')
  process.exit(1)
}

// ── one purchasable product ────────────────────────────────────────────────
const listing = await call('GET', '/storefront/products?limit=12', { token: shopper })
let pick = null
for (const card of listing.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token: shopper })
  const variant = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (variant) {
    pick = { productId: full.body.data.id, variantId: variant.id, price: Number(variant.price) }
    break
  }
}

const stamp = Math.floor(Math.random() * 9000 + 1000)
const code = (suffix) => `LIM${stamp}${suffix}`
const made = []
const yesterday = new Date(Date.now() - 86_400_000).toISOString()
const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString()
const tomorrow = new Date(Date.now() + 86_400_000).toISOString()

const makeDiscount = async (body) => {
  const res = await call('POST', '/admin/discounts', {
    token: admin,
    body: {
      type: 'PERCENT',
      value: 10,
      appliesTo: 'PRODUCTS',
      productIds: [pick.productId],
      startsAt: yesterday,
      combinesWithProduct: true,
      ...body,
    },
  })
  if (res.status !== 201) {
    console.error('fixture failed', res.status, JSON.stringify(res.body))
    process.exit(1)
  }
  made.push(res.body.data)
  return res.body.data
}

const forSomeoneElse = await makeDiscount({
  code: code('MINE'),
  eligibility: 'SPECIFIC_CUSTOMERS',
  customerIds: [someoneElse.id],
})
await makeDiscount({ code: code('QTY'), minRequirement: 'ITEM_QUANTITY', minQuantity: 5 })
await makeDiscount({ code: code('OVER'), endsAt: yesterday, startsAt: lastWeek })
await makeDiscount({ code: code('SOON'), startsAt: tomorrow })
await makeDiscount({ code: code('TOTAL'), usageLimit: 1 })
await makeDiscount({ code: code('EACH'), perUserLimit: 1 })

// ── a checkout to try them on ──────────────────────────────────────────────
const priorCart = (await call('GET', '/storefront/cart', { token: shopper })).body?.data?.items ?? []
for (const item of priorCart) await call('DELETE', `/storefront/cart/items/${item.id}`, { token: shopper })
const open = await call('GET', '/storefront/checkout/active', { token: shopper })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token: shopper })

await call('POST', '/storefront/cart/items', {
  token: shopper,
  body: { variantId: pick.variantId, quantity: 1 },
})
const session = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data

const tryCode = (id, value) =>
  call('POST', `/storefront/checkout/${id}/coupons`, { token: shopper, body: { code: value } })

// ── eligibility ────────────────────────────────────────────────────────────
const notMine = await tryCode(session.id, code('MINE'))
check(
  'a code for named customers is refused for anybody else',
  notMine.status === 422 && notMine.body?.error?.code === 'COUPON_NOT_FOUND',
  notMine.body?.error?.message,
)
check(
  'and gives nothing away — same answer as an unknown code',
  notMine.body?.error?.message === (await tryCode(session.id, 'NEVERACODE')).body?.error?.message,
)

// the same code, once this customer is on the list
await call('PUT', `/admin/discounts/${forSomeoneElse.id}`, {
  token: admin,
  body: {
    code: code('MINE'),
    type: 'PERCENT',
    value: 10,
    appliesTo: 'PRODUCTS',
    productIds: [pick.productId],
    startsAt: yesterday,
    combinesWithProduct: true,
    eligibility: 'SPECIFIC_CUSTOMERS',
    customerIds: [someoneElse.id, me.id],
  },
})
const nowMine = await tryCode(session.id, code('MINE'))
check('and works once that customer is named on it', nowMine.status === 200, `status ${nowMine.status}`)
await call(
  'DELETE',
  `/storefront/checkout/${session.id}/coupons/${nowMine.body.data.discounts[0].couponId}`,
  { token: shopper },
)

// ── minimum quantity ───────────────────────────────────────────────────────
const tooFew = await tryCode(session.id, code('QTY'))
check(
  'a minimum quantity that is not met is refused, with the numbers',
  tooFew.status === 422 &&
    /Add 5 eligible items/.test(tooFew.body?.error?.message ?? '') &&
    /You have 1/.test(tooFew.body?.error?.reason ?? ''),
  `${tooFew.body?.error?.message} ${tooFew.body?.error?.reason ?? ''}`,
)

// ── the clock ──────────────────────────────────────────────────────────────
const over = await tryCode(session.id, code('OVER'))
check(
  'an expired code is refused',
  over.status === 422 && over.body?.error?.code === 'COUPON_EXPIRED',
  over.body?.error?.message,
)
const soon = await tryCode(session.id, code('SOON'))
check(
  'a code that has not started yet is refused',
  soon.status === 422 && soon.body?.error?.code === 'COUPON_NOT_STARTED',
  soon.body?.error?.message,
)

// ── spend both limited codes on a real order ───────────────────────────────
const withTotal = await tryCode(session.id, code('TOTAL'))
check('a limited code applies while it has room', withTotal.status === 200)
const withEach = await tryCode(session.id, code('EACH'))
check('as does a once-per-customer code', withEach.status === 200)

const address = (await call('GET', '/storefront/addresses', { token: shopper })).body.data[0]
await call('POST', `/storefront/checkout/${session.id}/address`, {
  token: shopper,
  body: { shippingAddressId: address.id },
})
const payment = await call('POST', '/storefront/payments', {
  token: shopper,
  key: crypto.randomUUID(),
  body: { checkoutSessionId: session.id },
})
await call('POST', `/storefront/payments/${payment.body.data.id}/mock-complete`, {
  token: shopper,
  body: { outcome: 'success' },
})

let order = null
for (let attempt = 0; attempt < 20 && !order; attempt++) {
  const settled = await call('GET', `/storefront/checkout/${session.id}`, { token: shopper })
  if (settled.body?.data?.order) order = settled.body.data.order
  else await new Promise((resolve) => setTimeout(resolve, 250))
}
check('the order went through with both codes', Boolean(order), order?.orderNumber)

// ── and now they are spent ─────────────────────────────────────────────────
await call('POST', '/storefront/cart/items', {
  token: shopper,
  body: { variantId: pick.variantId, quantity: 1 },
})
const second = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data

const exhausted = await tryCode(second.id, code('TOTAL'))
check(
  'a code with one use left is refused once it is used',
  exhausted.status === 422 && exhausted.body?.error?.code === 'COUPON_EXHAUSTED',
  exhausted.body?.error?.message,
)

const alreadyUsed = await tryCode(second.id, code('EACH'))
check(
  'and a once-per-customer code is refused to the same customer',
  alreadyUsed.status === 422 && alreadyUsed.body?.error?.code === 'COUPON_ALREADY_USED',
  `${alreadyUsed.body?.error?.message} — ${alreadyUsed.body?.error?.reason ?? ''}`,
)

const counted = await call('GET', `/admin/discounts?q=${code('TOTAL')}`, { token: admin })
check('the admin list shows it used up', counted.body?.data?.[0]?.usedCount === 1, `used ${counted.body?.data?.[0]?.usedCount}`)

// ── a held code counts against the limit before any order exists ───────────
const heldCode = await makeDiscount({ code: code('HELD'), usageLimit: 1 })
const holding = await tryCode(second.id, code('HELD'))
check('a fresh limited code applies', holding.status === 200)
const heldRow = await call('GET', `/admin/discounts?q=${code('HELD')}`, { token: admin })
check(
  'holding it does not yet count as used',
  heldRow.body?.data?.[0]?.usedCount === 0,
  `used ${heldRow.body?.data?.[0]?.usedCount}`,
)
/**
 * The claim worth proving: a code **held** by an unfinished checkout is already
 * unavailable to somebody else. Counting only completed orders is exactly how a
 * one-use code gets used twice.
 *
 * That needs a second customer, so this registers a throwaway one and removes
 * it again at the end.
 */
const guestEmail = `discount-test-${stamp}@example.com`
const registered = await call('POST', '/storefront/auth/register', {
  body: {
    email: guestEmail,
    password: 'Customer@12345',
    firstName: 'Limit',
    lastName: 'Tester',
  },
})
check('a second customer can be registered for the race', registered.status === 201, `status ${registered.status}`)
const guest = registered.body?.data?.accessToken

await call('POST', '/storefront/cart/items', {
  token: guest,
  body: { variantId: pick.variantId, quantity: 1 },
})
const guestSession = (await call('POST', '/storefront/checkout', { token: guest, body: {} })).body.data
const raced = await call('POST', `/storefront/checkout/${guestSession.id}/coupons`, {
  token: guest,
  body: { code: code('HELD') },
})
check(
  'a code held by another checkout is already gone',
  raced.status === 422 && raced.body?.error?.code === 'COUPON_EXHAUSTED',
  raced.body?.error?.message,
)
await call('DELETE', `/storefront/checkout/${guestSession.id}`, { token: guest })

await call('DELETE', `/storefront/checkout/${second.id}`, { token: shopper })
const afterCancel = await call('GET', `/admin/discounts/${heldCode.id}`, { token: admin })
check(
  'cancelling the checkout gives the code back',
  afterCancel.body?.data?.usedCount === 0,
  `used ${afterCancel.body?.data?.usedCount}`,
)
const reusable = (await call('POST', '/storefront/cart/items', {
  token: shopper,
  body: { variantId: pick.variantId, quantity: 1 },
}))
const third = (await call('POST', '/storefront/checkout', { token: shopper, body: {} })).body.data
const again = await tryCode(third.id, code('HELD'))
check('so it can be applied again', again.status === 200, `status ${again.status}`)
await call('DELETE', `/storefront/checkout/${third.id}`, { token: shopper })

console.log(`\n${passed}/${passed + failed} passed`)
console.log(`order to remove: ${order?.orderNumber ?? 'none'}`)
console.log(`codes to remove: ${made.map((d) => d.code).join(', ')}`)
console.log(`throwaway account to remove: ${guestEmail}`)
process.exit(failed ? 1 : 0)
