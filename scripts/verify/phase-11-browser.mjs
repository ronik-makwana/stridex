#!/usr/bin/env node
// Phase 11 browser checks. Needs the storefront on :5174 and the API on :4000.
//   npm i -D playwright && npx playwright install chromium
//   node scripts/verify/phase-11-browser.mjs
import { chromium } from 'playwright'

const BASE = 'http://localhost:5174'
const email = `pw.${Date.now()}@example.com`
const PASSWORD = 'Sneaker@123'
const shots = process.env.SHOTS ?? new URL('./screenshots/', import.meta.url).pathname
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
const pageErrors = []
// A guest's bootstrap /auth/refresh 401s by design, and this run deliberately
// submits a wrong password. The browser logs both as console errors; neither is
// an application fault. Uncaught JS exceptions are tracked separately and none
// are tolerated.
const EXPECTED_401 = /status of 401/
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (EXPECTED_401.test(m.text())) return
  consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(String(e)))

// 1 — the shell
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${shots}/01-home.png`, fullPage: true })
ok('home renders the wordmark', (await page.locator('header a[aria-label="StrideX home"]').count()) === 1)
ok('home renders the nav', (await page.getByRole('navigation').first().getByText('Women').count()) > 0)
ok('home renders the footer', (await page.locator('footer').getByText('© ' + new Date().getFullYear() + ' StrideX').count()) === 1)
ok('hero heading present', (await page.getByRole('heading', { level: 1 }).innerText()).includes('long way round'))

// 2 — the guard bounces a signed-out visitor and remembers where they were
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
ok('guest at /account is bounced to login with a redirect param',
   page.url().endsWith('/login?redirect=%2Faccount'), page.url().replace(BASE, ''))
await page.screenshot({ path: `${shots}/02-login-guarded.png` })

// 3 — register
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
await page.locator('#firstName').fill('Ada')
await page.locator('#lastName').fill('Lovelace')
await page.locator('#email').fill(email)
await page.locator('#password').fill(PASSWORD)
await page.locator('#phone').fill('9876543210')
await page.screenshot({ path: `${shots}/03-register-filled.png` })
await page.getByRole('button', { name: 'Create account' }).click()
await page.getByRole('heading', { name: 'Check your inbox' }).waitFor({ timeout: 10000 })
ok('register lands on "check your email", not a redirect', true)
ok('the confirmation names the address', (await page.locator('body').innerText()).includes(email))
await page.screenshot({ path: `${shots}/04-check-email.png` })

// 4 — hard refresh keeps the session
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
ok('session survives a hard refresh', page.url().endsWith('/account'), page.url().replace(BASE, ''))
const accountText = await page.locator('main').innerText()
ok('/account shows the signed-in customer', accountText.includes(email) && accountText.includes('Ada Lovelace'))
ok('unverified customer sees the verify banner', accountText.includes('Verify your email'))
await page.screenshot({ path: `${shots}/05-account.png`, fullPage: true })

// 5 — the open-redirect attempt, while signed in
for (const evil of ['//evil.com', '/\\evil.com', 'https://evil.com']) {
  await page.goto(`${BASE}/login?redirect=${encodeURIComponent(evil)}`, { waitUntil: 'networkidle' })
  ok(`signed-in /login?redirect=${evil} stays on this site`,
     page.url().startsWith(BASE), page.url())
}

// 6 — sign out, then the same attack on the login form itself
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL(`${BASE}/`, { timeout: 10000 })
ok('sign out returns to the home page', true)

await page.goto(`${BASE}/login?redirect=${encodeURIComponent('//evil.com')}`, { waitUntil: 'networkidle' })
await page.locator('#email').fill(email)
await page.locator('#password').fill(PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10000 })
ok('login with a hostile redirect lands on this site, not evil.com',
   page.url().startsWith(BASE), page.url())
await page.screenshot({ path: `${shots}/06-after-login.png`, fullPage: true })

// 7 — a wrong password is a banner, not a field error
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL(`${BASE}/`, { timeout: 10000 })
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.locator('#email').fill(email)
await page.locator('#password').fill('WrongPassword1')
await page.getByRole('button', { name: 'Sign in' }).click()
const alert = page.getByRole('alert')
await alert.waitFor({ timeout: 10000 })
ok('wrong password shows a generic banner', (await alert.innerText()).includes('Invalid email or password'))
await page.screenshot({ path: `${shots}/07-bad-password.png` })

// 8 — an admin account is refused with the same message
await page.locator('#email').fill('admin@shoe.com')
await page.locator('#password').fill('Admin@12345')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForTimeout(1200)
ok('admin account is refused at the customer login',
   page.url().includes('/login') && (await page.getByRole('alert').innerText()).includes('Invalid email or password'))

ok('no uncaught JS exceptions', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
ok('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
console.log(JSON.stringify({ email }))
process.exit(failed.length ? 1 : 0)
