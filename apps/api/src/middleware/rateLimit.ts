import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { isProduction } from '../config/env.js'
import { tooManyRequests } from '../lib/errors.js'

const handler = (_req: unknown, _res: unknown, next: (err: Error) => void) => {
  next(tooManyRequests())
}

/** Blanket limiter for the whole API. Generous — this is a spike guard. */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: isProduction ? 300 : 10_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
})

/**
 * Login and password reset. Keyed on IP *and* email so one attacker cannot lock
 * out a real user by spraying their address, and so rotating IPs still hits a
 * per-account ceiling.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isProduction ? 10 : 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : ''
    return `${ipKeyGenerator(req.ip ?? '')}:${email}`
  },
  handler,
})

/**
 * Cart and wishlist hydrate. Public, unauthenticated, and it takes an array of
 * ids — which is a catalog dump with extra steps unless it is held down. A real
 * customer hits this on a page load and a merge, not in a loop.
 */
export const hydrateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isProduction ? 30 : 1_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
})

/** Refresh runs on every tab focus; it needs headroom but not none. */
export const refreshLimiter = rateLimit({
  windowMs: 60_000,
  limit: isProduction ? 30 : 1_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
})
