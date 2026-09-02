//   npm i -D playwright && npx playwright install chromium
//   node scripts/verify/phase-19-browser.mjs
//
// Phase 19 is the one phase a typecheck cannot reach. Route splitting, an error
// boundary, per-route titles and injected JSON-LD are all runtime behaviour —
// they compile whether or not they work.
import { chromium } from 'playwright'

const SHOP = process.env.SHOP_URL ?? 'http://localhost:5174'
let passed = 0
let failed = 0

const ok = (label, condition, detail = '') => {
  if (condition) { passed++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

/**
 * `networkidle` is not enough after clicking into a lazy route: the URL changes
 * before the chunk is fetched, its data requested, or the title effect run — so
 * asserting on it measured the page we just left. Waiting for the heading is
 * the signal that the route actually mounted.
 */
const openProduct = async (page) => {
  await page.waitForURL('**/products/**')
  await page.locator('h1').first().waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.title !== 'StrideX')
}

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

// Every JS file the browser fetches, so route splitting is observed rather than
// assumed: a bundle that was never split still renders every page correctly.
const chunks = new Set()
page.on('response', (res) => {
  const url = res.url()
  if (url.endsWith('.js') && url.includes('/assets/')) chunks.add(url.split('/assets/')[1])
})

console.log('\n── code splitting ──')
await page.goto(`${SHOP}/`, { waitUntil: 'networkidle' })
const afterHome = new Set(chunks)
ok('home loads a handful of chunks, not one bundle', afterHome.size > 1 && afterHome.size < 12, `${afterHome.size} files`)
ok('checkout is NOT among them', ![...afterHome].some((c) => c.startsWith('checkout-')))

const listing = await page.locator('a[href^="/products/"]').first()
await listing.click()
await openProduct(page)
const newChunks = [...chunks].filter((c) => !afterHome.has(c))
ok('navigating to a product fetches a new chunk', newChunks.length > 0, newChunks.join(', ') || 'none')

console.log('\n── page titles ──')
const seen = {}
seen.product = await page.title()
ok('product page has its own title', /·\s*StrideX$/.test(seen.product) && !/^StrideX$/.test(seen.product), seen.product)
// The catalogue enters titles as `<Brand> <Model>`, so a naive brand prefix
// doubles it. Caught only by looking at the rendered string.
const brandWord = seen.product.split(' ')[0]
ok('the brand is not duplicated in it', seen.product.split(brandWord).length === 2, seen.product)

await page.goto(`${SHOP}/cart`, { waitUntil: 'networkidle' })
seen.cart = await page.title()
ok('cart has its own title', /Cart/.test(seen.cart), seen.cart)
ok('title is not doubled', !/StrideX.*StrideX/.test(seen.cart), seen.cart)

await page.goto(`${SHOP}/login`, { waitUntil: 'networkidle' })
seen.login = await page.title()
ok('auth route sets a title too', /Sign in/.test(seen.login), seen.login)
ok('titles actually change between routes', new Set(Object.values(seen)).size === 3)

console.log('\n── JSON-LD ──')
await page.goto(`${SHOP}/`, { waitUntil: 'networkidle' })
await page.locator('a[href^="/products/"]').first().click()
await openProduct(page)
const ld = await page.locator('script#ld-json').textContent().catch(() => null)
ok('a JSON-LD block is present on the PDP', Boolean(ld))
let parsed = null
try { parsed = JSON.parse(ld ?? 'null') } catch { /* reported below */ }
ok('it is valid JSON', Boolean(parsed))
ok('it is a Product with an offer', parsed?.['@type'] === 'Product' && Boolean(parsed?.offers), parsed?.offers?.['@type'])
ok('the offer carries a price and availability',
  Boolean(parsed?.offers?.lowPrice) && String(parsed?.offers?.availability ?? '').includes('schema.org'),
  `${parsed?.offers?.lowPrice} · ${parsed?.offers?.availability?.split('/').pop()}`)

await page.goto(`${SHOP}/cart`, { waitUntil: 'networkidle' })
const strayLd = await page.locator('script#ld-json').count()
ok('the block is removed when leaving the product', strayLd === 0)

console.log('\n── meta description ──')
await page.goto(`${SHOP}/`, { waitUntil: 'networkidle' })
await page.locator('a[href^="/products/"]').first().click()
await openProduct(page)
const desc = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null)
const home = 'Shoes for the long way round'
// The point is not that a description exists — it is that it is *this page's*.
// A product with none must show none, never the last route's.
ok('the product does not inherit another page\'s description', !desc?.includes(home),
   desc ? `${desc.slice(0, 48)}…` : 'none (product has no description of its own)')

console.log('\n── error boundary ──')
// A route that does not exist as a chunk: the closest thing to a stale deploy
// without rebuilding mid-session.
await page.route('**/assets/*.js', (route) => {
  const url = route.request().url()
  if (url.includes('/assets/wishlist-')) return route.fulfill({ status: 404, body: '' })
  return route.continue()
})
await page.goto(`${SHOP}/`, { waitUntil: 'networkidle' })
await page.goto(`${SHOP}/wishlist`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const body = (await page.locator('body').innerText()).toLowerCase()
ok('a failed chunk shows the boundary, not a blank page', body.length > 40, `${body.length} chars rendered`)
ok('and it offers a reload', /refresh|reload/.test(body), body.split('\n').filter(Boolean)[0] ?? '')

await browser.close()
console.log(`\n${passed}/${passed + failed} passed\n`)
process.exit(failed === 0 ? 0 : 1)
