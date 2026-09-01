#!/usr/bin/env node
// Phase 13 browser checks. Needs the storefront on :5174 and the API on :4000.
//   npm i -D playwright && npx playwright install chromium
//   node scripts/verify/phase-13-browser.mjs
import { chromium } from 'playwright'
const BASE='http://localhost:5174'
const shots=process.env.SHOTS ?? new URL('./screenshots/', import.meta.url).pathname, results=[]
const ok=(n,p,d='')=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}${d?` — ${d}`:''}`)}
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1440,height:1000}})).newPage()
const errs=[]; p.on('pageerror',e=>errs.push(String(e)))
// `products?` — the count line is singular at 1, and a regex that only matches
// the plural silently reads 0 and looks exactly like a broken filter.
const count = async () => Number((/(\d+) products?/.exec(await p.locator('main').innerText()) ?? [,'0'])[1])

// ── category page ───────────────────────────────────────────────────────────
await p.goto(`${BASE}/categories/men`,{waitUntil:'networkidle'})
await p.getByRole('heading',{level:1}).waitFor()
ok('category page renders its name', (await p.getByRole('heading',{level:1}).innerText()).trim()==='Men')
ok('breadcrumbs render', (await p.getByLabel('Breadcrumb').innerText()).includes('Home'))
ok('subtree products are counted', await count() === 91, `${await count()} products`)
ok('grid renders cards', (await p.locator('main a[href^="/products/"]').count()) > 0)
ok('sidebar lists the available filters', /brand/i.test(await p.locator('main aside').innerText()))
ok('facet groups start collapsed', (await p.locator('main aside label').count()) === 0,
   `${await p.locator('main aside label').count()} checkboxes visible`)
await p.screenshot({path:`${shots}/13-category.png`,fullPage:false})

// ── the done-when: two filters update URL, grid and remaining counts ─────────
const aside = p.locator('main aside')
const before = await count()
// Facet groups are collapsed by default, so open the one under test first.
await aside.getByRole('button',{name:/Upper Material/i}).click()
await p.waitForTimeout(300)
const meshRow = aside.locator('label').filter({hasText:/^Mesh/}).first()
const meshCount = Number((/(\d+)$/.exec((await meshRow.innerText()).trim()) ?? [,'0'])[1])
await meshRow.locator('input').click()
await p.waitForTimeout(900)
const afterMesh = await count()
ok('ticking a facet narrows the grid', afterMesh < before, `${before} -> ${afterMesh}`)
ok('the URL carries the filter', /attr%3A|attr:/.test(p.url()), p.url().split('?')[1] ?? '')
ok('the grid matches the count the sidebar promised', afterMesh === meshCount, `grid ${afterMesh}, sidebar said ${meshCount}`)

// second facet, a brand.
// The label and the checkbox must come from ONE resolution of the row: the
// facet list re-renders when the first filter settles, and reading a count from
// one query then clicking another can pick two different brands — which looks
// exactly like a count/grid mismatch and is not one.
await p.waitForTimeout(400)
await aside.getByRole('button',{name:/^Brand/i}).click()
await p.waitForTimeout(300)
const brandBlock = aside.getByRole('button',{name:/^Brand/i}).locator('..')
const brandRow = brandBlock.locator('label').first()
const promised = Number((/(\d+)\s*$/.exec((await brandRow.innerText()).trim()) ?? [,'0'])[1])
const brandCheckbox = brandRow.locator('input')
await brandCheckbox.click()
await p.waitForTimeout(900)
const afterBoth = await count()
ok('a second facet narrows further', afterBoth <= afterMesh, `${afterMesh} -> ${afterBoth}`)
ok('remaining counts updated together', afterBoth === promised, `grid ${afterBoth}, brand row said ${promised}`)
ok('both filters are in the URL', /brand=/.test(p.url()) && /attr/.test(p.url()))
await p.screenshot({path:`${shots}/13-filtered.png`,fullPage:false})

// reload must restore exactly
const url = p.url()
await p.reload({waitUntil:'networkidle'})
await p.waitForTimeout(700)
ok('a reload restores the filtered grid', await count() === afterBoth)
// A group holding a selection re-opens itself, so the tick is visible without
// the customer hunting for which collapsed group it is in.
ok('a group with a selection re-opens after reload',
   await aside.locator('label').filter({hasText:/^Mesh/}).first().locator('input').isChecked())

// clear all
await aside.getByText('Clear all').click()
await p.waitForTimeout(800)
ok('clear all restores the full grid', await count() === before)
ok('and empties the query string', !/attr|brand=/.test(p.url()), p.url())

// ── sort ────────────────────────────────────────────────────────────────────
const priceOf = async () => (await p.locator('main a[href^="/products/"]').first().innerText()).match(/₹([\d,]+)/)?.[1]?.replace(/,/g,'')
await p.locator('main select').last().selectOption('price_asc')
await p.waitForTimeout(900)
const cheap = Number(await priceOf())
await p.locator('main select').last().selectOption('price_desc')
await p.waitForTimeout(900)
const dear = Number(await priceOf())
ok('price sort actually reorders', dear > cheap, `asc ${cheap}, desc ${dear}`)
ok('sort is in the URL', /sort=price_desc/.test(p.url()))

// ── pagination ──────────────────────────────────────────────────────────────
await p.goto(`${BASE}/categories/men`,{waitUntil:'networkidle'})
await p.waitForTimeout(600)
const firstTitle = await p.locator('main a[href^="/products/"] h3').first().innerText()
await p.getByRole('navigation',{name:'Pagination'}).getByRole('button',{name:'2'}).click()
await p.waitForTimeout(900)
ok('page 2 shows different products', (await p.locator('main a[href^="/products/"] h3').first().innerText()) !== firstTitle)
ok('page is in the URL', /page=2/.test(p.url()))

// ── header mega-menu ────────────────────────────────────────────────────────
await p.goto(`${BASE}/`,{waitUntil:'networkidle'})
await p.waitForTimeout(500)
const nav = p.locator('header nav').first()
ok('nav is built from the real tree', (await nav.innerText()).includes('Men') && (await nav.innerText()).includes('Kids'))
await nav.getByText('Women',{exact:true}).hover()
await p.waitForTimeout(400)
const panel = p.locator('header a[href^="/categories/women-"]')
ok('hovering opens the mega-panel', (await panel.count()) >= 5, `${await panel.count()} child links`)
await p.screenshot({path:`${shots}/13-megamenu.png`,clip:{x:0,y:0,width:1440,height:420}})

// ── search ──────────────────────────────────────────────────────────────────
await p.getByRole('button',{name:'Search'}).click()
await p.waitForTimeout(300)
await p.getByRole('textbox',{name:'Search'}).fill('nike')
await p.waitForTimeout(900)
ok('suggest returns products', (await p.locator('a[href^="/products/"]').count()) > 0)
await p.keyboard.press('Enter')
await p.waitForURL(/\/search\?q=nike/,{timeout:5000})
await p.waitForTimeout(900)
ok('enter goes to the search grid', /\/search\?q=nike/.test(p.url()))
ok('search results are the same grid with facets', /brand/i.test(await p.locator('main aside').innerText()))
ok('search has results', await count() > 0, `${await count()} products`)

// ── collections index ───────────────────────────────────────────────────────
await p.goto(`${BASE}/collections`,{waitUntil:'networkidle'})
await p.waitForTimeout(500)
ok('collections index renders', (await p.getByRole('heading',{level:1}).innerText()).includes('Collections'))

// Ratings on cards come from one grouped query per page, and only appear where
// a product has PUBLISHED reviews — an unreviewed card shows no stars at all
// rather than five empty ones.
await p.goto(`${BASE}/search?q=carina`,{waitUntil:'networkidle'})
await p.waitForTimeout(1000)
const cardTexts = await p.locator('main a[href^="/products/"]').allInnerTexts()
const rated = cardTexts.filter(t => /\d\.\d\s*\|\s*\d/.test(t))
ok('every card carries a rating row', rated.length === cardTexts.length, `${rated.length} of ${cardTexts.length}`)
ok('a reviewed product shows its real average', cardTexts.some(t => /5\.0\s*\|\s*1/.test(t)))
ok('an unreviewed product reads 0.0 | 0', cardTexts.some(t => /0\.0\s*\|\s*0/.test(t)))

// ── 404s ────────────────────────────────────────────────────────────────────
await p.goto(`${BASE}/categories/not-a-category`,{waitUntil:'networkidle'})
await p.waitForTimeout(500)
ok('unknown category is the 404 page', (await p.locator('main').innerText()).includes('cannot find that page'))

ok('no uncaught JS exceptions', errs.length===0, errs.slice(0,2).join(' | '))
await b.close()
const f=results.filter(r=>!r.p)
console.log(`\n${results.length-f.length}/${results.length} passed`)
process.exit(f.length?1:0)
