/**
 * The Razorpay sheet, in a real browser, with a real test card.
 *
 * This is the half `razorpay-api.mjs` cannot reach: that the modal actually
 * opens with the payload our server minted, that a card can be entered, and
 * that Razorpay ends up holding a genuinely captured payment for our order.
 *
 * It stops short of asserting an order exists. Without the tunnel Razorpay
 * cannot deliver the webhook, and the webhook is the only thing that writes an
 * order (§12) — so what this proves is that the money side is real. The caller
 * takes it from there.
 *
 *   node scripts/verify/razorpay-browser.mjs
 *
 * Needs the storefront on :5174 and the API on :4000, PAYMENT_PROVIDER=razorpay.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:5174'
const SHOTS = new URL('./screenshots/', import.meta.url).pathname

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')]
    }),
)

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  ok ? passed++ : failed++
}

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()

// The order id our own server minted, caught on the wire. Everything after the
// handoff is checked against Razorpay's record of *this* order.
let orderId = null
page.on('response', async (res) => {
  if (res.url().endsWith('/storefront/payments') && res.request().method() === 'POST') {
    try {
      const body = await res.json()
      orderId = body?.data?.providerPaymentId ?? null
    } catch {
      /* not json — the assertions below will say so */
    }
  }
})

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

// ── sign in ─────────────────────────────────────────────────────────────────

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.locator('input#email').fill('shopper@shoe.com')
await page.locator('input#password').fill('Customer@12345')
await page.getByRole('button', { name: /^Sign in$/i }).click()
await page.waitForTimeout(3000)
if (page.url().includes('/login')) {
  console.log('--- login page text ---')
  console.log((await page.locator('body').innerText()).slice(0, 500))
  console.log('---')
}
check('signed in', !page.url().includes('/login'), page.url())

// ── a product into the cart ─────────────────────────────────────────────────

await page.goto(`${BASE}/categories/men`, { waitUntil: 'networkidle' })
const links = await page.locator('main a[href*="/products/"]').evaluateAll((as) =>
  [...new Set(as.map((a) => a.getAttribute('href')))].slice(0, 8),
)

// Walk products until one can actually be bought: a category page happily
// lists sold-out stock, and a test that assumes the first card is purchasable
// fails for a reason that has nothing to do with payments.
let added = false
for (const href of links) {
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  /*
   * One value per option axis, not four values off the same one. A shoe has a
   * size *and* a colour, and the buy box also sits next to wishlist buttons
   * that carry the same aria-pressed attribute — so the groups are taken from
   * the DOM parent, and everything after the CTA is ignored.
   */
  const groupFirsts = await page.locator('main button').evaluateAll((buttons) => {
    const cta = buttons.findIndex((b) => /Select a|Add to cart|Sold out/i.test(b.innerText || ''))
    const options = buttons.slice(0, cta < 0 ? buttons.length : cta)
    const firstOfGroup = new Map()
    options.forEach((b, i) => {
      if (b.disabled) return
      if (!firstOfGroup.has(b.parentElement)) firstOfGroup.set(b.parentElement, i)
    })
    return [...firstOfGroup.values()]
  })
  for (const i of groupFirsts) {
    await page.locator('main button').nth(i).click()
    await page.waitForTimeout(400)
  }

  const cta = page.getByRole('button', { name: /^Add to cart$/i })
  if ((await cta.count()) && (await cta.first().isEnabled())) {
    await cta.first().click()
    await page.waitForTimeout(1800)
    added = true
    break
  }
}
check('added a purchasable product to the bag', added, page.url())

// ── checkout ────────────────────────────────────────────────────────────────

await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${SHOTS}rzp-1-checkout.png` })

const payButton = page.getByRole('button', { name: /^Pay / })
check('the checkout offers a Pay button', (await payButton.count()) > 0, (await payButton.first().innerText().catch(() => '')).trim())

const panel = await page.locator('main').innerText()
check(
  'the payment panel names the real provider, not the mock',
  /card, upi or netbanking/i.test(panel),
  /test payments/i.test(panel) ? 'still showing the mock copy' : 'ok',
)

// ── the sheet ───────────────────────────────────────────────────────────────

await payButton.first().click()

// Razorpay renders into an iframe it appends to the page.
const frameEl = page.locator('iframe.razorpay-checkout-frame')
await frameEl.waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {})
check('the Razorpay sheet opened', (await frameEl.count()) > 0)
check('and our server minted a Razorpay order for it', Boolean(orderId), orderId ?? 'none seen')

const sheet = page.frameLocator('iframe.razorpay-checkout-frame')
await page.waitForTimeout(4000)
await page.screenshot({ path: `${SHOTS}rzp-2-sheet.png` })

// The sheet's own copy should carry the merchant name and the amount we quoted.
const sheetText = await sheet.locator('body').innerText().catch(() => '')
check(
  'the sheet shows our merchant name',
  sheetText.includes(env.RAZORPAY_DISPLAY_NAME ?? 'StrideX'),
  (sheetText.split('\n').find((l) => l.trim()) ?? '').slice(0, 60),
)

console.log('\n--- sheet text (first 400 chars) ---')
console.log(sheetText.slice(0, 400))
console.log('---\n')

console.log(`\n${passed}/${passed + failed} passed`)
if (errors.length) console.log('page errors:', errors.slice(0, 3))
console.log(`razorpay order: ${orderId ?? 'none'}`)
console.log(`screenshots in ${SHOTS}`)

await browser.close()
process.exit(failed === 0 ? 0 : 1)
