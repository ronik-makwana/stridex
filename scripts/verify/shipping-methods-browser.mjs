/**
 * The checkout page, in the order the customer reads it:
 * contact → delivery address → shipping method → billing address → payment.
 *
 * The delivery address is one address with a menu behind "…", not a grid of
 * every address on file — and the shipping list has to move the summary, or it
 * is three radio buttons that lie.
 */
import { chromium } from 'playwright'

const API = 'http://localhost:4000/api'
const SHOP = 'http://localhost:5174'
const SHOT = process.env.SHOT_DIR ?? 'scripts/verify/screenshots'

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

// ── fixture: a shopper with two addresses and one thing in the cart ──────────
const login = await call('POST', '/storefront/auth/login', {
  body: { email: 'shopper@shoe.com', password: 'Customer@12345' },
})
const token = login.body.data.accessToken

const before = await call('GET', '/storefront/cart', { token })
const restore = before.body?.data?.items ?? []
for (const item of restore) await call('DELETE', `/storefront/cart/items/${item.id}`, { token })

const active = await call('GET', '/storefront/checkout/active', { token })
if (active.body?.data) await call('DELETE', `/storefront/checkout/${active.body.data.id}`, { token })

const list = await call('GET', '/storefront/products?limit=12', { token })
let variant = null
for (const card of list.body.data) {
  const full = await call('GET', `/storefront/products/${card.slug}`, { token })
  const found = full.body?.data?.variants?.find((v) => v.stock !== 'SOLD_OUT')
  if (found) {
    variant = found
    break
  }
}
await call('POST', '/storefront/cart/items', { token, body: { variantId: variant.id, quantity: 1 } })

const madeAddresses = []
// Work with whatever the account already has — an address saved by hand is not
// this script's to delete — and top it up to the two the menu needs.
const book = await call('GET', '/storefront/addresses', { token })
const saved = book.body?.data ?? []
if (saved.length === 0) {
  const made = await call('POST', '/storefront/addresses', {
    token,
    body: {
      fullName: 'Sam Shopper',
      phone: '9876543210',
      addressLine1: '12 Test Lane',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'IN',
      postalCode: '400058',
      isDefault: true,
    },
  })
  saved.push(made.body.data)
  madeAddresses.push(made.body.data.id)
}
if (saved.length === 1) {
  const made = await call('POST', '/storefront/addresses', {
    token,
    body: {
      fullName: 'Sam At Work',
      phone: '9876543210',
      addressLine1: '9 Office Park',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'IN',
      postalCode: '411001',
      isDefault: false,
    },
  })
  saved.push(made.body.data)
  madeAddresses.push(made.body.data.id)
}
const primary = saved.find((address) => address.isDefault) ?? saved[0]
const other = saved.find((address) => address.id !== primary.id)

// ── the page ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
const page = await context.newPage()

await page.goto(`${SHOP}/login`, { waitUntil: 'load' })
await page.getByRole('textbox', { name: /email/i }).fill('shopper@shoe.com')
await page.getByRole('textbox', { name: /password/i }).fill('Customer@12345')
await page.getByRole('button', { name: /sign in|log in/i }).click()
await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 })

await page.goto(`${SHOP}/checkout`, { waitUntil: 'load' })
await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor({ timeout: 15000 })
await page.getByText('Shipping method').first().waitFor({ timeout: 15000 })

// 1. the order of the sections
const headings = await page.locator('section h2, section > div > h2').allInnerTexts()
const order = headings.map((text) => text.trim().toLowerCase()).filter(Boolean)
const wanted = ['contact', 'delivery address', 'shipping method', 'billing address', 'payment']
check(
  'the sections read in the intended order',
  wanted.every((label, index) => order[index] === label),
  order.slice(0, 5).join(' → '),
)

// 2. every saved address, one per line, exactly one of them chosen
const deliverySection = page.locator('section').filter({ hasText: 'Delivery address' }).first()
const addressRows = deliverySection.locator('button[aria-pressed]')
check(
  'every saved address is listed',
  (await addressRows.count()) === saved.length,
  `${await addressRows.count()} of ${saved.length}`,
)

const chosenRows = deliverySection.locator('button[aria-pressed="true"]')
check('exactly one is selected', (await chosenRows.count()) === 1)
check(
  'and it is the default, chosen without asking',
  (await chosenRows.first().innerText()).includes(primary.fullName),
)
check(
  'each line carries the whole address',
  (await addressRows.first().innerText()).replace(/\s+/g, ' ').includes(primary.postalCode),
)
check(
  'a different address can be used',
  await deliverySection.getByRole('button', { name: /use a different address/i }).isVisible(),
)

// 3. selecting another one
await addressRows.filter({ hasText: other.fullName }).click()
await page.waitForTimeout(1200)
check(
  'selecting a line changes the delivery address',
  (await deliverySection.locator('button[aria-pressed="true"]').first().innerText()).includes(
    other.fullName,
  ),
  `now ${other.fullName}`,
)
check(
  'and only one stays selected',
  (await deliverySection.locator('button[aria-pressed="true"]').count()) === 1,
)

// 3b. the address form, in a modal
await deliverySection.getByRole('button', { name: /use a different address/i }).click()
const dialog = page.getByRole('dialog')
await dialog.waitFor({ timeout: 5000 })
check('the link opens a dialog', await dialog.isVisible())
check(
  'it offers to save, and to cancel',
  (await dialog.getByRole('button', { name: /^save address$/i }).isVisible()) &&
    (await dialog.getByRole('button', { name: /^cancel$/i }).isVisible()),
)
await dialog.getByRole('button', { name: /^cancel$/i }).click()
await page.waitForTimeout(400)
check('cancel closes it and saves nothing', (await page.getByRole('dialog').count()) === 0)

await deliverySection.getByRole('button', { name: /use a different address/i }).click()
await page.getByRole('dialog').waitFor({ timeout: 5000 })
const form = page.getByRole('dialog')
await form.getByLabel('Full name').fill('Sam Third')
await form.getByLabel('Phone').fill('9510894621')
await form.getByLabel('Address', { exact: true }).fill('B-202, Angel Palace')
await form.getByLabel('City').fill('Surat')
await form.getByLabel('State').fill('Gujarat')
await form.getByLabel('PIN code').fill('394190')
await form.getByRole('button', { name: /^save address$/i }).click()
await page.waitForTimeout(2000)
check('saving closes the dialog', (await page.getByRole('dialog').count()) === 0)
const listAfterSave = await deliverySection.innerText()
check('the new address joins the list', listAfterSave.includes('Sam Third'))
check(
  'and is selected for this order',
  (await deliverySection.locator('button[aria-pressed="true"]').first().innerText()).includes(
    'Sam Third',
  ),
)

// 4. the shipping list, and whether it moves the money
const shipping = page.locator('section').filter({ hasText: 'Shipping method' }).first()
const options = shipping.locator('button[aria-pressed]')
check('three services are listed', (await options.count()) === 3, `${await options.count()} listed`)
const listText = await shipping.innerText()
check(
  'each names a price and a delivery window',
  /Standard/.test(listText) && /business day/.test(listText) && /₹|Free/.test(listText),
)

const summary = page.locator('aside').first()
const totalBefore = (await summary.innerText()).match(/Total\s*₹([\d,]+)/)?.[1]

await options.filter({ hasText: 'Express' }).click()
await page.waitForTimeout(1500)
const summaryAfter = await summary.innerText()
const totalAfter = summaryAfter.match(/Total\s*₹([\d,]+)/)?.[1]
check(
  'choosing express changes the total in the summary',
  totalBefore && totalAfter && totalBefore !== totalAfter,
  `₹${totalBefore} → ₹${totalAfter}`,
)
check(
  'and the summary shows the express charge',
  summaryAfter.includes('249'),
  summaryAfter.split('\n').find((line) => line.startsWith('Shipping')) ?? '',
)
check(
  'express is marked as chosen',
  (await options.filter({ hasText: 'Express' }).getAttribute('aria-pressed')) === 'true',
)

// 5. billing: a dropdown, and Pay waits for it
const billing = page.locator('section').filter({ hasText: 'Billing address' }).first()
const payButton = page.locator('aside').getByRole('button', { name: /^Pay ₹/ })
check('billing defaults to same as delivery', await billing.getByLabel(/same as delivery/i).isChecked())
check('and Pay is available', await payButton.isEnabled())

await billing.getByLabel(/same as delivery/i).uncheck()
await page.waitForTimeout(600)

// Counted from the delivery list rather than remembered: the dialog above
// added one, and the two must agree whatever that number is.
const deliveryCount = await deliverySection.locator('button[aria-pressed]').count()
const billingSelect = billing.getByLabel(/saved addresses/i)
check('unticking it offers a dropdown of saved addresses', await billingSelect.isVisible())
const optionLabels = await billingSelect.locator('option').allInnerTexts()
check(
  'every saved address is an option, plus a new one',
  optionLabels.length === deliveryCount + 2 && /use a new address/i.test(optionLabels.at(-1)),
  optionLabels.length + ' options',
)
check('nothing is preselected', (await billingSelect.inputValue()) === '')
check('and Pay is refused until it is answered', await payButton.isDisabled())
check(
  'with the reason said out loud',
  (await page.locator('aside').innerText()).toLowerCase().includes('billing address'),
)

// choosing a saved one settles it
const savedValue = await billingSelect.locator('option').nth(1).getAttribute('value')
await billingSelect.selectOption(savedValue)
await page.waitForTimeout(1500)
check('choosing a saved address settles billing', await payButton.isEnabled())
check(
  'and it is read back in full',
  (await billing.innerText()).includes(primary.postalCode) ||
    (await billing.innerText()).includes(other.postalCode),
)

// 'use a new address' opens the fields inline, and un-settles Pay until saved
await billingSelect.selectOption('new')
await page.waitForTimeout(600)
check('"use a new address" opens the form inline', await billing.getByLabel('PIN code').isVisible())
check('and Pay waits for it to be saved', await payButton.isDisabled())

await billing.getByRole('button', { name: /^cancel$/i }).click()
await page.waitForTimeout(400)
check('cancelling closes the form', (await billing.getByLabel('PIN code').count()) === 0)

await billing.getByLabel(/same as delivery/i).check()
await page.waitForTimeout(1200)
check('re-ticking it puts billing back on the delivery address', await payButton.isEnabled())

await page.screenshot({ path: `${SHOT}/checkout-sections.png`, fullPage: true })
console.log(`screenshot: ${SHOT}/checkout-sections.png`)

await browser.close()

// ── put the fixture back ─────────────────────────────────────────────────────
const open = await call('GET', '/storefront/checkout/active', { token })
if (open.body?.data) await call('DELETE', `/storefront/checkout/${open.body.data.id}`, { token })
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
/**
 * Anything this script has ever created, by name as well as by id — a run that
 * crashes mid-way leaves rows behind, and the next run must not adopt them as
 * "already there" and leave them forever.
 */
const OURS = new Set(['Sam Shopper', 'Sam At Work', 'Sam Third'])
const finalBook = await call('GET', '/storefront/addresses', { token })
for (const address of finalBook.body?.data ?? []) {
  if (madeAddresses.includes(address.id) || OURS.has(address.fullName)) {
    await call('DELETE', `/storefront/addresses/${address.id}`, { token })
  }
}

console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed ? 1 : 0)
