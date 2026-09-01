#!/usr/bin/env node
// Phase 12 browser checks. Needs the storefront on :5174 and the API on :4000.
//   node scripts/verify/phase-12-browser.mjs
import { chromium } from 'playwright'
const BASE = 'http://localhost:5174'
const SLUG = 'puma-carina-street-casual'       // 5 images, 8 on sale, 2 sold out, 1 low
const ONE_IMAGE = 'nike-revolution-7-road-trainer'
const shots = process.env.SHOTS ?? new URL('./screenshots/', import.meta.url).pathname
const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

await page.goto(`${BASE}/products/${SLUG}`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { level: 1 }).waitFor()

ok('product page renders the title', (await page.getByRole('heading', { level: 1 }).innerText()).includes('Carina'))
ok('breadcrumbs show the category chain', (await page.getByLabel('Breadcrumb').innerText()).replace(/\n/g, ' ').includes('Women'))
ok('gallery shows the cover image', (await page.locator('main img').first().isVisible()))
ok('thumbnail strip has 5 thumbs', (await page.getByRole('group', { name: 'Product images' }).getByRole('button').count()) === 5)

// Thumbnails swap the main image.
const before = await page.locator('main img').first().getAttribute('src')
await page.getByRole('group', { name: 'Product images' }).getByRole('button').nth(2).click()
await page.waitForTimeout(200)
const after = await page.locator('main img').first().getAttribute('src')
ok('clicking a thumbnail swaps the main image', before !== after)

// Markdown rendering.
const buyBox = page.locator('main').locator('div').filter({ has: page.getByRole('heading', { level: 1 }) }).last()
ok('sale price shows a strikethrough compare-at', (await page.locator('.line-through').first().isVisible()))
ok('discount pill renders', (await page.getByText(/%\s*off/).first().isVisible()))

// Option pickers, in the product's axis order: Size then Colour.
const headings = await page.locator('main h2').allInnerTexts()
ok('pickers render in position order (Size before Colour)',
   headings.indexOf('Size') >= 0 && headings.indexOf('Size') < headings.indexOf('Colour'),
   headings.filter((h) => ['Size', 'Colour'].includes(h)).join(' then '))

// CTA before any pick.
const cta = page.getByRole('button', { name: /Select a|Add to bag|Sold out/ })
ok('CTA prompts for the missing axis first', /Select a/.test(await cta.innerText()), await cta.innerText())

// Sold-out size must be struck through, not hidden. Size 6 is sold out in both colours.
const sizeButtons = page.locator('main button').filter({ hasText: /^(3|4|5|6)$/ })
ok('all four sizes are rendered, none hidden', (await sizeButtons.count()) === 4)
const six = sizeButtons.filter({ hasText: /^6$/ }).first()
const sixClass = (await six.getAttribute('class')) ?? ''
ok('the sold-out size is struck through', sixClass.includes('line-through'))
ok('the sold-out size is still clickable (not disabled)', !(await six.isDisabled()))

// Pick the sold-out combination and confirm the page says so.
await six.click()
await page.waitForTimeout(150)
const swatches = page.getByRole('button', { name: /Black|Beige/ })
await swatches.first().click()
await page.waitForTimeout(250)
ok('choosing a sold-out combination disables the CTA', await cta.isDisabled())
ok('CTA reads "Sold out"', (await cta.innerText()).trim() === 'Sold out')
ok('an explanation appears', (await page.getByText(/sold out\. Try another/i).isVisible()))
await page.screenshot({ path: `${shots}/12-soldout.png`, fullPage: false })

// Pick an in-stock combination.
await sizeButtons.filter({ hasText: /^4$/ }).first().click()
await page.waitForTimeout(250)
ok('choosing an in-stock combination enables the CTA', !(await cta.isDisabled()))
ok('CTA reads "Add to bag"', (await cta.innerText()).trim() === 'Add to bag')
ok('the price resolves to the chosen variant', (await page.getByText(/₹/).first().isVisible()))

// Low stock label. Size 3 / Beige is LOW_STOCK.
await sizeButtons.filter({ hasText: /^3$/ }).first().click()
await swatches.filter({ hasText: /Beige/ }).or(page.locator('[aria-label*="Beige"]')).first().click()
await page.waitForTimeout(250)
const bodyText = await page.locator('main').innerText()
const body = bodyText.toLowerCase() // headings are uppercased by CSS
ok('low stock reads "Only a few left", never a count',
   body.includes('only a few left') && !/\b(only )?\d+ left\b/.test(body))

// Spec table + related + reviews slot.
ok('spec table renders attributes', body.includes('specification') && body.includes('upper material'))
ok('"You may also like" renders cards', (await page.locator('main a[href^="/products/"]').count()) > 0)
// Reviews are real now, so this asserts the section renders and summarises —
// not that it is empty, which was only true while it was a placeholder.
ok('reviews section renders with a summary', body.includes('customer reviews') && /out of 5/.test(body))
await page.screenshot({ path: `${shots}/12-product.png`, fullPage: true })

// Never a raw stock number anywhere on the page.
ok('no raw stock count leaked into the page', !/\b\d+\s+(in stock|available|left in stock)\b/i.test(bodyText))

// Single-image product hides the strip entirely.
await page.goto(`${BASE}/products/${ONE_IMAGE}`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { level: 1 }).waitFor()
ok('single-image product hides the thumbnail strip',
   (await page.getByRole('group', { name: 'Product images' }).count()) === 0)
await page.screenshot({ path: `${shots}/12-one-image.png` })

// A missing product is the 404 page, inside the shell.
await page.goto(`${BASE}/products/no-such-product-exists`, { waitUntil: 'networkidle' })
ok('unknown slug renders the 404 page', (await page.locator('main').innerText()).includes('cannot find that page'))

ok('no uncaught JS exceptions', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
