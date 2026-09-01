/**
 * The discount editor, through the browser.
 *
 * What this has to prove is that the form and the server agree: every branch
 * the operator can choose is stored as chosen, the branches they did *not*
 * choose leave nothing behind, and a definition that cannot mean anything is
 * refused with the message beside the field that caused it.
 */
import { chromium } from 'playwright'

const API = 'http://localhost:4000/api'
const ADMIN = 'http://localhost:5175'
const SHOT = process.env.SHOT_DIR ?? 'scripts/verify/screenshots'
const CODE = `VERIFY${Math.floor(Math.random() * 9000 + 1000)}`

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

const login = await call('POST', '/admin/auth/login', {
  body: { email: 'admin@shoe.com', password: 'Admin@12345' },
})
const token = login.body.data.accessToken

/**
 * Every discount that exists before the run, so the end of the run can say
 * exactly what it created — and fail if that is more than it meant to. A form
 * that submits itself shows up here as an extra row rather than as a mystery
 * in the table a week later.
 */
const preexisting = new Set(
  ((await call('GET', '/admin/discounts?limit=50', { token })).body?.data ?? []).map((row) => row.id),
)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
const page = await context.newPage()

await page.goto(`${ADMIN}/login`, { waitUntil: 'load' })
await page.getByRole('textbox', { name: /email/i }).fill('admin@shoe.com')
await page.getByRole('textbox', { name: /password/i }).fill('Admin@12345')
await page.getByRole('button', { name: /sign in|log in/i }).click()
await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 })

// ── the sidebar entry ────────────────────────────────────────────────────────
const sidebarLink = page.getByRole('link', { name: 'Discounts' })
// Waited for rather than asserted on sight: the shell renders before the nav.
await sidebarLink.waitFor({ timeout: 10000 })
check('Discounts is in the sidebar', await sidebarLink.isVisible())
await sidebarLink.click()
await page.waitForURL(/\/discounts$/, { timeout: 10000 })
await page.getByRole('heading', { name: 'Discounts' }).waitFor({ timeout: 10000 })

await page.getByRole('button', { name: /create discount/i }).first().click()
await page.waitForURL(/\/discounts\/new$/, { timeout: 10000 })
await page.getByLabel('Discount code').waitFor({ timeout: 10000 })

// ── only a code, no automatic method ─────────────────────────────────────────
const firstCard = await page.locator('section').first().innerText()
check('the first card offers a code and nothing else', !/automatic discount/i.test(firstCard))
check('no purchase type field', (await page.getByText(/purchase type/i).count()) === 0)
check('no internal note field', (await page.getByText(/internal note/i).count()) === 0)

// ── generate a code ──────────────────────────────────────────────────────────
await page.getByRole('button', { name: /generate random code/i }).click()
const generated = await page.getByLabel('Discount code').inputValue()
check('generate fills a code', /^[A-Z0-9]{10}$/.test(generated), generated)

await page.getByLabel('Discount code').fill(CODE)

// ── applies to: three options ────────────────────────────────────────────────
const appliesTo = page.getByLabel('Applies to')
await appliesTo.click()
const options = await page.getByRole('option').allInnerTexts()
check(
  'applies to offers products, categories and collections',
  options.length === 3 &&
    /products/i.test(options[0]) &&
    /categories/i.test(options[1]) &&
    /collections/i.test(options[2]),
  options.join(' / '),
)
await page.getByRole('option', { name: /specific products/i }).click()

// ── saving with no products chosen is refused, at the field ──────────────────
await page.getByLabel(/^Percentage$/).fill('20')
await page.getByRole('button', { name: /^create discount$/i }).click()
await page.waitForTimeout(1500)
check(
  'a product discount with no products is refused',
  await page.getByText(/choose at least one product/i).isVisible(),
)
check('and it did not navigate away', page.url().includes('/discounts/new'))

// A Radix trigger with no type is a submit button. Opening this select must
// not save the discount — the count is the proof.
const beforeSelect = (await call('GET', '/admin/discounts', { token })).body.meta.total
await page.getByLabel('Applies to').click()
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
check(
  'opening a select does not submit the form',
  (await call('GET', '/admin/discounts', { token })).body.meta.total === beforeSelect &&
    page.url().includes('/discounts/new'),
)

// ── pick products ────────────────────────────────────────────────────────────
await page.getByRole('button', { name: /select products/i }).click()
const picker = page.getByRole('dialog')
await picker.waitFor({ timeout: 5000 })
const boxes = picker.getByRole('checkbox')
await boxes.nth(0).click()
await boxes.nth(1).click()
check('the picker stages before saving', (await picker.getByText(/2 selected/i).count()) === 1)
await picker.getByRole('button', { name: /^cancel$/i }).click()
await page.waitForTimeout(400)
check(
  'cancel keeps nothing',
  (await page.getByRole('button', { name: /select products/i }).count()) === 1,
)

await page.getByRole('button', { name: /select products/i }).click()
await page.getByRole('dialog').waitFor({ timeout: 5000 })
await page.getByRole('dialog').getByRole('checkbox').nth(0).click()
await page.getByRole('dialog').getByRole('checkbox').nth(1).click()
await page.getByRole('dialog').getByRole('button', { name: /^save$/i }).click()
await page.waitForTimeout(600)
const valueCard = page.locator('section').filter({ hasText: 'Discount value' })
const chips = await valueCard.getByRole('button', { name: /^Remove / }).count()
check('saving keeps the choice as chips', chips === 2, `${chips} chips`)
// The server's complaint was answered by choosing — it must not still be on
// screen underneath the products that answered it.
check(
  'the earlier error cleared once products were chosen',
  (await page.getByText(/choose at least one product/i).count()) === 0,
)

// ── a duplicate category name is told apart by its parent ───────────────────
await page.getByLabel('Applies to').click()
await page.getByRole('option', { name: /specific categories/i }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /select categories/i }).click()
await page.getByRole('dialog').waitFor({ timeout: 5000 })
await page.getByRole('dialog').getByRole('textbox').last().fill('sneaker')
await page.waitForTimeout(1200)
const categoryRows = await page.getByRole('dialog').locator('li').allInnerTexts()
check(
  'a duplicate category name carries its parent',
  categoryRows.length > 1 && categoryRows.every((row) => row.includes('>')),
  categoryRows.join(' / '),
)
await page.getByRole('dialog').getByRole('button', { name: /^cancel$/i }).click()
await page.waitForTimeout(300)
await page.getByLabel('Applies to').click()
await page.getByRole('option', { name: /specific products/i }).click()
await page.waitForTimeout(400)

// ── the rest of the form ─────────────────────────────────────────────────────
await page.getByLabel('Specific customers').click()
await page.waitForTimeout(300)
check(
  'specific customers opens a customer picker',
  await page.getByRole('button', { name: /select customers/i }).isVisible(),
)
await page.getByLabel('All customers').click()

await page.getByLabel(/minimum purchase amount/i).click()
await page.waitForTimeout(300)
await page.locator('section').filter({ hasText: 'Minimum purchase' }).getByRole('textbox').fill('2000')

await page.getByLabel(/limit number of times/i).click()
await page.waitForTimeout(300)
await page.locator('section').filter({ hasText: 'Maximum discount uses' }).getByRole('textbox').fill('50')
await page.getByLabel(/limit to one use per customer/i).click()

await page.getByLabel('Order discounts').click()

// combinations are the three kinds, as asked
const combinations = await page.locator('section').filter({ hasText: 'Combinations' }).innerText()
check(
  'combinations names the three kinds',
  /product discounts/i.test(combinations) &&
    /order discounts/i.test(combinations) &&
    /shipping discounts/i.test(combinations),
)

check(
  'no status card in the sidebar',
  (await page.locator('aside').last().getByText('Status', { exact: true }).count()) === 0,
)

await page.screenshot({ path: `${SHOT}/discount-editor.png`, fullPage: true })

await page.getByRole('button', { name: /^create discount$/i }).click()
await page.waitForURL(/\/discounts\/[0-9a-f-]{36}$/, { timeout: 15000 })
check('it saved and opened the discount', true, page.url().split('/').pop())
// The URL changes before the editor has rendered the saved discount.
await page.getByRole('heading', { name: CODE, level: 1 }).waitFor({ timeout: 10000 })
const headerText = await page.locator('h1').first().locator('..').innerText()
check(
  'the state is shown beside the code at the top',
  headerText.includes(CODE) && /active/i.test(headerText),
  headerText.replace(/\n/g, ' · '),
)

// ── what actually landed in the database ─────────────────────────────────────
const list = await call('GET', `/admin/discounts?q=${CODE}`, { token })
const saved = list.body?.data?.[0]
const full = saved ? (await call('GET', `/admin/discounts/${saved.id}`, { token })).body.data : null

check('the code was stored upper-case', full?.code === CODE, full?.code)
check('as a product discount', full?.kind === 'PRODUCT' && full?.appliesTo === 'PRODUCTS')
check('with both products', full?.products?.length === 2, `${full?.products?.length} products`)
check('20 percent off', full?.type === 'PERCENT' && Number(full?.value) === 20)
check('minimum ₹2,000', full?.minRequirement === 'PURCHASE_AMOUNT' && Number(full?.minCartValue) === 2000)
check('capped at 50 uses', full?.usageLimit === 50)
check('one use per customer', full?.perUserLimit === 1)
check('combines with order discounts only', full?.combinesWithOrder === true && full?.combinesWithProduct === false)
check('it is live from its start date', full?.state === 'ACTIVE', full?.state)

// ── the unchosen branches left nothing behind ────────────────────────────────
check(
  'nothing was stored for the branches not chosen',
  full?.categories?.length === 0 &&
    full?.collections?.length === 0 &&
    full?.customers?.length === 0 &&
    full?.minQuantity === null,
)

// ── editing: switch to collections, the products should go ───────────────────
await page.getByLabel('Applies to').click()
await page.getByRole('option', { name: /specific collections/i }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /select collections/i }).click()
await page.getByRole('dialog').waitFor({ timeout: 5000 })
await page.getByRole('dialog').getByRole('checkbox').nth(0).click()
await page.getByRole('dialog').getByRole('button', { name: /^save$/i }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: /save changes/i }).click()
await page.waitForTimeout(2000)

const afterEdit = (await call('GET', `/admin/discounts/${saved.id}`, { token })).body.data
check(
  'switching what it applies to clears the old targets',
  afterEdit.appliesTo === 'COLLECTIONS' &&
    afterEdit.collections.length === 1 &&
    afterEdit.products.length === 0,
  `${afterEdit.products.length} products, ${afterEdit.collections.length} collections`,
)

// ── deactivate ends it now, activate clears the end date ────────────────────
check('the header offers Duplicate', await page.getByRole('button', { name: /^duplicate$/i }).isVisible())

await page.getByRole('button', { name: /more actions/i }).click()
const menuItems = await page.getByRole('menu').getByRole('menuitem').allInnerTexts()
check(
  'more actions offers exactly deactivate and delete',
  menuItems.length === 2 && /deactivate/i.test(menuItems[0]) && /delete/i.test(menuItems[1]),
  menuItems.join(' / '),
)
await page.getByRole('menuitem', { name: /deactivate/i }).click()
await page.waitForTimeout(1800)

const deactivated = (await call('GET', `/admin/discounts/${saved.id}`, { token })).body.data
check('deactivate ends it now', deactivated.state === 'EXPIRED', deactivated.state)
check(
  'by setting the end date, not a flag',
  deactivated.endsAt !== null && new Date(deactivated.endsAt) <= new Date(),
  deactivated.endsAt,
)

await page.getByRole('button', { name: /more actions/i }).click()
const expiredMenu = await page.getByRole('menu').getByRole('menuitem').allInnerTexts()
check(
  'an expired discount offers activate instead',
  /activate/i.test(expiredMenu[0]) && !/deactivate/i.test(expiredMenu[0]),
  expiredMenu.join(' / '),
)
await page.getByRole('menuitem', { name: /^activate$/i }).click()
await page.waitForTimeout(1800)

const reactivated = (await call('GET', `/admin/discounts/${saved.id}`, { token })).body.data
check('activate clears the end date', reactivated.endsAt === null && reactivated.state === 'ACTIVE')

// ── duplicate prefills a new one rather than saving a copy ──────────────────
const before = (await call('GET', '/admin/discounts', { token })).body.meta.total
await page.getByRole('button', { name: /^duplicate$/i }).click()
await page.waitForURL(/\/discounts\/new$/, { timeout: 10000 })
// The heading is what changes last; reading the input before it is reading the
// page we just left.
await page.getByRole('heading', { name: 'Duplicate discount' }).waitFor({ timeout: 10000 })
const duplicatedCode = await page.getByLabel('Discount code').inputValue()
check('duplicate opens a new discount with a blank code', duplicatedCode === '', duplicatedCode)
check(
  'with the original selections carried over',
  (await page.getByRole('button', { name: /edit collections/i }).isVisible()),
)
const after = (await call('GET', '/admin/discounts', { token })).body.meta.total
check('and nothing was saved until Create is pressed', after === before, `${before} → ${after}`)

// ── a duplicate code is refused by the unique index ──────────────────────────
const duplicate = await call('POST', '/admin/discounts', {
  token,
  body: {
    code: CODE.toLowerCase(),
    type: 'FIXED',
    value: 100,
    appliesTo: 'COLLECTIONS',
    collectionIds: afterEdit.collections.map((row) => row.id),
    startsAt: new Date().toISOString(),
  },
})
check('a duplicate code is refused', duplicate.status === 409, `status ${duplicate.status}`)

// ── expiry is derived, not stored ────────────────────────────────────────────
const past = await call('POST', '/admin/discounts', {
  token,
  body: {
    code: `${CODE}OLD`,
    type: 'PERCENT',
    value: 10,
    appliesTo: 'COLLECTIONS',
    collectionIds: afterEdit.collections.map((row) => row.id),
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-02-01T00:00:00Z',
  },
})
check(
  'a discount whose end date has passed reads as expired',
  past.body?.data?.state === 'EXPIRED',
  past.body?.data?.state,
)

const expiredFilter = await call('GET', '/admin/discounts?state=EXPIRED', { token })
check(
  'and the expired filter finds it',
  (expiredFilter.body?.data ?? []).some((row) => row.code === `${CODE}OLD`),
)

await browser.close()

// ── what the run actually created, and cleanup ───────────────────────────────
const now = (await call('GET', '/admin/discounts?limit=50', { token })).body?.data ?? []
const created = now.filter((row) => !preexisting.has(row.id))
check(
  'the run created exactly the two discounts it meant to',
  created.length === 2,
  created.map((row) => row.code).join(', ') || 'none',
)

for (const row of created) await call('DELETE', `/admin/discounts/${row.id}`, { token })
const left = await call('GET', '/admin/discounts', { token })
console.log(`\ndiscounts left in the database: ${left.body?.meta?.total ?? '?'}`)
console.log(`${passed}/${passed + failed} passed`)
process.exit(failed ? 1 : 0)
