import rateLimit, { ipKeyGenerator, type Store } from 'express-rate-limit'
import { RedisStore, type RedisReply } from 'rate-limit-redis'
import { isProduction } from '../config/env.js'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { tooManyRequests } from '../lib/errors.js'

const handler = (_req: unknown, _res: unknown, next: (err: Error) => void) => {
  next(tooManyRequests())
}

/**
 * Shared by every limiter, and the one genuinely arguable decision in this file.
 *
 * `passOnStoreError` defaults to **false**, which means a Redis outage turns
 * every rate-limited request — which is all of them, `globalLimiter` is mounted
 * app-wide — into a 500. Losing the whole API because a cache is down is a
 * strictly worse outage than the one it is protecting against.
 *
 * The cost is real and worth stating plainly: while Redis is unreachable, the
 * login limiter is open. That is a brute-force window. It is still the better
 * trade — an outage that locks every customer out of signing in is not the
 * safer failure — but it is a trade, and `logger.error` is what makes it
 * visible rather than silent. Flip this to `false` for `authLimiter` alone if
 * the threat model ever says the window matters more than the availability.
 *
 * Note this is about Redis being *unreachable at runtime*, which is still a
 * thing that happens. It is not a fallback for Redis being unconfigured —
 * `config/env.ts` makes that impossible.
 */
const storeErrorPolicy = {
  passOnStoreError: true,
  logger: {
    error: (error: unknown, message?: string) => logger.error({ err: error }, message ?? 'rate limit store error'),
    warn: (error: unknown, message?: string) => logger.warn({ err: error }, message ?? 'rate limit store warning'),
  },
}

/**
 * One shared counter across every API process.
 *
 * Without this each process keeps its own tally, so N instances allow N times
 * the limit and every deploy resets every window. `authLimiter` is where that
 * stops being a performance detail: ten login attempts per fifteen minutes
 * becomes ten per instance, and a restart clears a lockout that was mid-attack.
 */
function sharedStore(prefix: string): Store {
  return new RedisStore({
    /**
     * Per limiter, and it has to be. The default (`rl:`) is one namespace, so
     * the global limiter and the refresh limiter would increment the *same* key
     * for the same IP — thirty refreshes would spend thirty of the three
     * hundred general requests, and neither budget would mean what it says.
     */
    prefix,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  })
}

/** Blanket limiter for the whole API. Generous — this is a spike guard. */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: isProduction ? 300 : 10_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: sharedStore('rl:global:'),
  ...storeErrorPolicy,
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
  store: sharedStore('rl:auth:'),
  ...storeErrorPolicy,
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
  store: sharedStore('rl:hydrate:'),
  ...storeErrorPolicy,
  handler,
})

/** Refresh runs on every tab focus; it needs headroom but not none. */
export const refreshLimiter = rateLimit({
  windowMs: 60_000,
  limit: isProduction ? 30 : 1_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: sharedStore('rl:refresh:'),
  ...storeErrorPolicy,
  handler,
})
