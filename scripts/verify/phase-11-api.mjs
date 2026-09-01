#!/usr/bin/env node
// Phase 11 acceptance checks. No dependencies — node 22's built-in fetch.
//   node verify-phase-11.mjs
// Creates one throwaway account and tells you how to delete it at the end.

const API = process.env.API ?? 'http://localhost:4000/api/storefront'
const ADMIN_API = process.env.ADMIN_API ?? 'http://localhost:4000/api/admin'
const email = `verify.${Date.now()}@example.com`
const password = 'Sneaker@123'

let passed = 0
const failures = []
const ok = (name, got, want) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${name}`); passed++ }
  else { console.log(`  FAIL  ${name}\n          got  ${g}\n          want ${w}`); failures.push(name) }
}
const group = (n) => console.log(`\n${n}`)

// Minimal cookie jar, so the refresh cookie can be replayed like a browser would.
let cookies = {}
async function call(url, { method = 'GET', body, token, sendCookies = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (sendCookies) headers.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const raw of setCookie) {
    const [pair] = raw.split(';')
    const i = pair.indexOf('=')
    cookies[pair.slice(0, i)] = pair.slice(i + 1)
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  return { status: res.status, json, setCookie }
}

group('1 — registration forces CUSTOMER and cannot be talked out of it')
const reg = await call(`${API}/auth/register`, {
  method: 'POST',
  // A hostile extra field: the schema has no `role`, and the service hard-codes it.
  body: { email, password, firstName: 'Verify', role: 'ADMIN' },
})
ok('register returns 201', reg.status, 201)
ok('role is CUSTOMER despite role:ADMIN in the body', reg.json?.data?.user?.role, 'CUSTOMER')
ok('emailVerified starts false', reg.json?.data?.user?.emailVerified, false)
ok('passwordHash is not in the payload', 'passwordHash' in (reg.json?.data?.user ?? {}), false)
ok('status is not leaked to the customer', 'status' in (reg.json?.data?.user ?? {}), false)
ok('the response says a verification email went out', reg.json?.data?.verificationEmailSent, true)

group('2 — the refresh token is an httpOnly cookie, never a JSON field')
const cookieHeader = reg.setCookie.find((c) => c.startsWith('shoe_shop_refresh='))
ok('a shop refresh cookie is set', Boolean(cookieHeader), true)
ok('it is HttpOnly', /HttpOnly/i.test(cookieHeader ?? ''), true)
ok('it is scoped to the storefront auth path', /Path=\/api\/storefront\/auth/i.test(cookieHeader ?? ''), true)
ok('refreshToken is NOT in the body', 'refreshToken' in (reg.json?.data ?? {}), false)
ok('the admin cookie name is not reused', /shoe_admin_refresh/.test(cookieHeader ?? ''), false)

group('3 — hard refresh: the cookie alone restores the session')
const refreshed = await call(`${API}/auth/refresh`, { method: 'POST', sendCookies: true })
ok('refresh returns 200 from the cookie only', refreshed.status, 200)
ok('it returns a fresh access token', typeof refreshed.json?.data?.accessToken, 'string')
const token = refreshed.json?.data?.accessToken
const me = await call(`${API}/auth/me`, { token })
ok('/auth/me accepts that token', me.status, 200)
ok('/auth/me returns the right customer', me.json?.data?.email, email)

group('4 — cross-audience rejection, with no oracle')
const adminOnShop = await call(`${API}/auth/login`, {
  method: 'POST', body: { email: 'admin@shoe.com', password: 'Admin@12345' },
})
ok('an admin at the customer login is 401', adminOnShop.status, 401)
ok('  ...with the same generic code a wrong password gets', adminOnShop.json?.error?.code, 'INVALID_CREDENTIALS')
const custOnAdmin = await call(`${ADMIN_API}/auth/login`, { method: 'POST', body: { email, password } })
ok('a customer at the admin login is 401', custOnAdmin.status, 401)
const adminOnAdmin = await call(`${ADMIN_API}/auth/login`, {
  method: 'POST', body: { email: 'admin@shoe.com', password: 'Admin@12345' },
})
ok('the admin console login still works (nothing regressed)', adminOnAdmin.status, 200)

group('5 — public endpoints are not account-existence oracles')
const fpUnknown = await call(`${API}/auth/forgot-password`, { method: 'POST', body: { email: 'nobody@nowhere.test' } })
const fpReal = await call(`${API}/auth/forgot-password`, { method: 'POST', body: { email } })
ok('forgot-password: byte-identical for unknown vs real', fpUnknown.json, fpReal.json)
ok('forgot-password: same status too', fpUnknown.status, fpReal.status)
const rvUnknown = await call(`${API}/auth/resend-verification`, { method: 'POST', body: { email: 'nobody@nowhere.test' } })
const rvStaff = await call(`${API}/auth/resend-verification`, { method: 'POST', body: { email: 'admin@shoe.com' } })
ok('resend-verification: identical for unknown vs a staff address', rvUnknown.json, rvStaff.json)

group('6 — guards and validation')
ok('/auth/me with no token is 401', (await call(`${API}/auth/me`)).status, 401)
ok('/auth/me with a junk token is 401', (await call(`${API}/auth/me`, { token: 'nonsense' })).status, 401)
ok('a junk verification token is 401',
  (await call(`${API}/auth/verify-email`, { method: 'POST', body: { token: 'deadbeef' } })).status, 401)
const weak = await call(`${API}/auth/register`, {
  method: 'POST', body: { email: `w.${Date.now()}@example.com`, password: 'short', firstName: 'W' },
})
ok('a weak password is a 400', weak.status, 400)
ok('  ...with the message on the password field', weak.json?.error?.fields?.password, 'Use at least 8 characters')
const dupe = await call(`${API}/auth/register`, { method: 'POST', body: { email, password, firstName: 'V' } })
ok('a duplicate email is a 409', dupe.status, 409)

group('7 — CORS lets the storefront origin through with credentials')
const preflight = await fetch(`${API}/auth/login`, {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://localhost:5174',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
})
ok('allow-origin is the storefront', preflight.headers.get('access-control-allow-origin'), 'http://localhost:5174')
ok('credentials are allowed (the refresh cookie needs this)', preflight.headers.get('access-control-allow-credentials'), 'true')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) console.log(failures.map((f) => `  - ${f}`).join('\n'))
console.log(`\nRemove the throwaway account:\n  docker compose exec -T postgres psql -U postgres -d shoe -c "DELETE FROM users WHERE email='${email}';"`)
process.exit(failures.length ? 1 : 0)
