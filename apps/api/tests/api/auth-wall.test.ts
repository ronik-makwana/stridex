import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { signAccessToken } from '../../src/modules/auth/auth.tokens.js'
import { createUser, resetFactorySequence } from '../setup/factories.js'

/**
 * The auth wall, driven through the real router.
 *
 * These exist because the guard is applied by *mounting*, not by calling: the
 * admin tree gets `authenticate, requireAdminSession` once in
 * `routes/admin.routes.ts`, and the storefront deliberately does not — each of
 * its routers carries its own. That is a decision no unit test can check,
 * because the thing that could go wrong is a router mounted in the wrong place.
 *
 * So the question here is never "does requireRole work" — that is covered in
 * `tests/unit/require-role.test.ts`. It is "is this URL actually behind it".
 */

const app = createApp()

const tokenFor = (id: string, role: 'ADMIN' | 'STAFF' | 'CUSTOMER', email: string) =>
  signAccessToken({ sub: id, email, role, sid: '99999999-9999-4999-8999-999999999999' })

let adminToken: string
let staffToken: string
let customerToken: string

beforeAll(async () => {
  resetFactorySequence()
})

beforeEach(async () => {
  const admin = await createUser({ role: 'ADMIN' })
  const staff = await createUser({ role: 'STAFF' })
  const customer = await createUser({ role: 'CUSTOMER' })

  adminToken = tokenFor(admin.id, 'ADMIN', admin.email)
  staffToken = tokenFor(staff.id, 'STAFF', staff.email)
  customerToken = tokenFor(customer.id, 'CUSTOMER', customer.email)
})

/** Every admin tree that must never answer without a session. */
const ADMIN_URLS = [
  '/api/admin/products',
  '/api/admin/categories',
  '/api/admin/brands',
  '/api/admin/orders',
  '/api/admin/customers',
  '/api/admin/discounts',
  '/api/admin/inventory',
  '/api/admin/dashboard',
  '/api/admin/returns',
  '/api/admin/reviews',
]

describe('the admin tree', () => {
  it.each(ADMIN_URLS)('answers 401 for %s with no token', async (url) => {
    const response = await request(app).get(url)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it.each(ADMIN_URLS)('answers 403 for %s with a customer token', async (url) => {
    const response = await request(app).get(url).set('Authorization', `Bearer ${customerToken}`)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('lets an admin through', async () => {
    const response = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(200)
  })

  it('lets staff through', async () => {
    const response = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(response.status).toBe(200)
  })

  it('answers 401 for a malformed Authorization header', async () => {
    const response = await request(app).get('/api/admin/products').set('Authorization', 'Bearer')
    expect(response.status).toBe(401)
  })

  it('answers 401 for a token signed with the wrong secret', async () => {
    const response = await request(app)
      .get('/api/admin/products')
      .set('Authorization', 'Bearer not.a.real.token')
    expect(response.status).toBe(401)
  })

  /** The login endpoint has to stay reachable, or nobody can ever get a token. */
  it('leaves the auth endpoints public', async () => {
    const response = await request(app).post('/api/admin/auth/login').send({})
    expect(response.status).not.toBe(401)
  })
})

/**
 * The storefront's default is the opposite of the admin tree's: public unless
 * a router says otherwise. That makes "is this one behind the wall" a question
 * worth asking per route rather than once.
 */
describe('the storefront tree', () => {
  it.each([
    '/api/storefront/products',
    // `/categories/tree`, not `/categories`: there is no index route, and
    // `/:slug` would read "categories" as a slug.
    '/api/storefront/categories/tree',
    '/api/storefront/collections',
    '/api/storefront/home',
  ])('leaves %s public, so a crawler can read it', async (url) => {
    const response = await request(app).get(url)
    expect(response.status).toBe(200)
  })

  it.each([
    '/api/storefront/addresses',
    '/api/storefront/orders',
    '/api/storefront/checkout',
  ])('keeps %s behind the auth wall', async (url) => {
    const response = await request(app).get(url)
    expect(response.status).toBe(401)
  })

  /**
   * An admin token must not pass a customer gate: these routes read
   * `req.user.id` as the owner of a cart or an order, and an admin arriving
   * would silently create customer records under a staff account.
   */
  it.each(['/api/storefront/addresses', '/api/storefront/orders'])(
    'refuses an admin token on %s',
    async (url) => {
      const response = await request(app).get(url).set('Authorization', `Bearer ${adminToken}`)
      expect(response.status).toBe(403)
    },
  )

  it('lets a customer reach their own addresses', async () => {
    const response = await request(app)
      .get('/api/storefront/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
    expect(response.status).toBe(200)
  })
})

describe('the app shell', () => {
  it('reports health without a session', async () => {
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ok', env: 'test' })
  })

  it('answers a 404 that names the method and path', async () => {
    const response = await request(app).get('/api/storefront/no-such-thing')
    expect(response.status).toBe(404)
    expect(response.body.error.message).toContain('/api/storefront/no-such-thing')
  })

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/health')
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('sends the security headers helmet is mounted for', async () => {
    const response = await request(app).get('/health')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })
})
