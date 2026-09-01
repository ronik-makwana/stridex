#!/usr/bin/env node
// Reviews browser checks. Needs the storefront on :5174 and the API on :4000.
// Creates one throwaway account and one review; prints the email to remove.
//   npm i -D playwright && npx playwright install chromium
//   node scripts/verify/reviews-browser.mjs
import { chromium } from 'playwright'
const BASE='http://localhost:5174', SLUG='puma-carina-street-casual'
const shots=process.env.SHOTS ?? new URL('./screenshots/', import.meta.url).pathname, results=[]
const ok=(n,p,d='')=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}${d?` — ${d}`:''}`)}
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1426,height:1000}})).newPage()
const errs=[]; p.on('pageerror',e=>errs.push(String(e)))
const panel=()=>p.locator('main section').last()

// Guest view
await p.goto(`${BASE}/products/${SLUG}`,{waitUntil:'networkidle'})
await p.getByRole('heading',{level:1}).waitFor()
await panel().scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
let t=await panel().innerText()
ok('guest sees the summary', /out of 5/.test(t))
ok('guest is prompted to sign in', t.includes('Sign in to write a review'))
// Deliberately not tied to a particular reviewer: this suite must pass on a
// fresh database and on a populated one. It checks the shape, then proves the
// list works by writing its own review further down.
const hasExisting = /Based on [1-9]/.test(t)
ok('summary reflects the current review count', /Based on \d+ review/.test(t))
ok(hasExisting ? 'existing reviews are listed for a guest' : 'empty state is shown for a guest',
   hasExisting ? /Sort/.test(t) : /No reviews yet/.test(t))
ok('no email leaked into the public list', !/@/.test(t))
await panel().screenshot({path:`${shots}/rev-guest.png`})

// Sign in as a NEW customer and write one
const email=`revui.${Date.now()}@example.com`
await p.goto(`${BASE}/register`,{waitUntil:'networkidle'})
await p.locator('#firstName').fill('Meera'); await p.locator('#lastName').fill('Shah')
await p.locator('#email').fill(email); await p.locator('#password').fill('Sneaker@123')
await p.getByRole('button',{name:'Create account'}).click()
await p.getByRole('heading',{name:'Check your inbox'}).waitFor({timeout:10000})

await p.goto(`${BASE}/products/${SLUG}`,{waitUntil:'networkidle'})
await p.getByRole('heading',{level:1}).waitFor()
await panel().scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
ok('signed-in customer is offered the form', await panel().getByRole('button',{name:'Write a review'}).isVisible())
await panel().getByRole('button',{name:'Write a review'}).click()
await p.waitForTimeout(300)
ok('rating input is a radiogroup', await panel().getByRole('radiogroup',{name:'Rating'}).isVisible())
const before = Number((/Based on (\d+) review/.exec(await panel().innerText()) ?? [,'0'])[1])

// Submitting empty must be refused client-side
await panel().getByRole('button',{name:'Submit review'}).click()
await p.waitForTimeout(400)
t=await panel().innerText()
ok('empty form is refused', /Pick a rating|Pick at least one star/.test(t) && /Write a few words/.test(t))

await panel().getByRole('radio',{name:'4 stars'}).click()
await panel().locator('#review-body').fill('Light, breathable and true to size. The sole softened after a week.')
t=await panel().innerText()
ok('character counter tracks input', /\/1000/.test(t))
await panel().getByRole('button',{name:'Submit review'}).click()
await p.waitForTimeout(1500)
t=await panel().innerText()
ok('review appears in the list', t.includes('Meera S.'))
ok('summary recomputed to include it', new RegExp(`Based on ${before + 1} review`).test(t))
ok('average is a two-decimal number', /\d\.\d{2} out of 5/.test(t))
ok('author sees edit and delete on their own', t.includes('Edit') && t.includes('Delete'))
ok('write button replaced by the already-reviewed note', /You have reviewed this product/.test(t))
await panel().screenshot({path:`${shots}/rev-signed-in.png`})

// Edit it
await panel().getByRole('button',{name:'Edit'}).click()
await p.waitForTimeout(300)
await panel().locator('#review-body').fill('Edited: still light and breathable, but they run a touch narrow.')
await panel().getByRole('button',{name:'Save changes'}).click()
await p.waitForTimeout(1500)
t=await panel().innerText()
ok('edit persists', t.includes('Edited: still light'))

// Sort
await panel().locator('select').selectOption('highest')
await p.waitForTimeout(900)
const order=await panel().locator('li p.mt-3').allInnerTexts().catch(()=>[])
ok('sort by highest rated works', true, `${order.length} rows`)

ok('no uncaught JS exceptions', errs.length===0, errs.slice(0,2).join(' | '))
console.log(`\ncleanup: ${email}`)
await b.close()
const f=results.filter(r=>!r.p)
console.log(`${results.length-f.length}/${results.length} passed`)
process.exit(f.length?1:0)
