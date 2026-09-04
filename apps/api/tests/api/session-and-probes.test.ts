import { prisma } from '@shoe/db'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { signAccessToken } from '../../src/modules/auth/auth.tokens.js'
import { createUser, resetFactorySequence } from '../setup/factories.js'

/**
 * Three things that are only observable through the whole app: whether a
 * revoked session can still write, whether the webhook route escapes the rate
 * limiter, and whether readiness actually asks its dependencies anything.
 */

const app = createApp()

beforeEach(() => {
  resetFactorySequence()
})

/** A real session row plus a token naming it, which is what the strict check reads. */
async function signIn(
  overrides: { role?: 'ADMIN' | 'STAFF'; status?: 'ACTIVE' | 'SUSPENDED' } = {},
) {
  const user = await createUser({ role: overrides.role ?? 'ADMIN', status: overrides.status })

  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: `hash-${user.id}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    },
  })

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: overrides.role ?? 'ADMIN',
    sid: session.id,
  })

  return { user, session, token }
}

describe('a revoked admin session', () => {
  /**
   * Reads stay stateless on purpose: they are most of the traffic, and a stale
   * read for a few minutes is recoverable in a way a stale write is not.
   */
  it('can still read until the access token expires', async () => {
    const { session, token } = await signIn()
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })

    const response = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
  })

  /**
   * Writes must not. Before this check existed, revoking a session left that
   * person deleting products for the remaining life of their token.
   */
  it('cannot write', async () => {
    const { session, token } = await signIn()
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })

    const response = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Should Not Exist', slug: 'should-not-exist' })

    expect(response.status).toBe(401)
    expect(await prisma.brand.count()).toBe(0)
  })

  it('cannot delete', async () => {
    const { session, token } = await signIn()
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })

    const response = await request(app)
      .delete('/api/admin/brands/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
  })
})

describe('a suspended admin', () => {
  it('cannot write, even with a session that was never revoked', async () => {
    const { user, token } = await signIn()
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } })

    const response = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope', slug: 'nope' })

    expect(response.status).toBe(401)
    expect(await prisma.brand.count()).toBe(0)
  })
})

describe('an expired session row', () => {
  it('cannot write even while the access token is still valid', async () => {
    const { session, token } = await signIn()
    await prisma.userSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const response = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope', slug: 'nope-2' })

    expect(response.status).toBe(401)
  })
})

describe('a live admin session', () => {
  it('can still write', async () => {
    const { token } = await signIn()

    const response = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Perfectly Fine', slug: 'perfectly-fine' })

    expect(response.status).toBe(201)
    expect(await prisma.brand.count()).toBe(1)
  })

  /**
   * A role changed mid-session takes effect on the next write rather than
   * waiting for a refresh — the strict check re-reads it from the row.
   */
  it('picks up a role demotion without waiting for a refresh', async () => {
    const { user, token } = await signIn({ role: 'ADMIN' })
    await prisma.user.update({ where: { id: user.id }, data: { role: 'CUSTOMER' } })

    const response = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope', slug: 'nope-3' })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.brand.count()).toBe(0)
  })
})

describe('the rate limiter', () => {
  /**
   * `standardHeaders: 'draft-7'` means a request the limiter counted carries
   * `RateLimit` headers. Their presence is the observable proof of whether the
   * limiter ran, without having to send ten thousand requests to trip it.
   */
  it('counts ordinary API requests', async () => {
    const response = await request(app).get('/api/storefront/products')
    expect(response.headers).toHaveProperty('ratelimit')
  })

  /**
   * A provider retries anything that is not 2xx, so a 429 here does not shed
   * load — it delays a payment confirmation and then asks for it again.
   */
  it('does not count webhook deliveries', async () => {
    const response = await request(app)
      .post('/api/webhooks/payments/razorpay')
      .set('Content-Type', 'application/json')
      .send('{}')

    // Unsigned, so it is rejected — but by the signature check, not a limiter.
    expect(response.status).toBe(401)
    expect(response.headers).not.toHaveProperty('ratelimit')
  })

  it('never answers a webhook with 429, however many arrive at once', async () => {
    const deliveries = await Promise.all(
      Array.from({ length: 40 }, () =>
        request(app)
          .post('/api/webhooks/payments/razorpay')
          .set('Content-Type', 'application/json')
          .send('{}'),
      ),
    )

    expect(deliveries.every((response) => response.status !== 429)).toBe(true)
  })
})

describe('the probes', () => {
  /**
   * Liveness. Stays 200 even when the worker is stale: the instance genuinely
   * is serving, and pulling it from a load balancer over a background job would
   * be the worse outage.
   */
  it('reports liveness without touching the database', async () => {
    const response = await request(app).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ok', env: 'test' })
    expect(response.body).toHaveProperty('worker')
  })

  /** Readiness asks the dependencies rather than just replying. */
  it('reports readiness with the database reachable', async () => {
    const response = await request(app).get('/ready')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ready', database: true })
  })

  it('reports the cache separately from the database', async () => {
    const response = await request(app).get('/ready')
    expect(response.body).toHaveProperty('cache')
  })

  it('needs no session, or a load balancer could never call it', async () => {
    expect((await request(app).get('/ready')).status).toBe(200)
    expect((await request(app).get('/health')).status).toBe(200)
  })
})
