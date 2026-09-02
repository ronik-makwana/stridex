import { redis } from './redis.js'
import { logger } from './logger.js'

/**
 * Read-through caching over Redis.
 *
 * **A cache is never allowed to change an answer, only its latency.** Every
 * function here swallows its own errors and falls through to the loader, so a
 * Redis that is unreachable makes the API slower and never wrong. That is not
 * defensive habit — `passOnStoreError` in the rate limiter exists for the same
 * reason, and it is the property that lets these be added to hot paths without
 * making Redis a new way for the catalogue to go down.
 *
 * What is deliberately *not* cached: anything a customer's money depends on.
 * Prices are re-read at checkout, stock is read inside the reservation
 * transaction, and totals come from `POST /checkout/validate`. A cache in front
 * of any of those would be a stale number somebody gets charged.
 *
 * ## Cache serialized output, never Prisma rows
 *
 * The one rule to keep. Values here round-trip through `JSON.stringify`, and
 * `Prisma.Decimal` does not survive it — it comes back a plain string with no
 * methods. Caching rows therefore produces a bug that **cannot appear on the
 * request that writes the cache**, only on the next one: the first call
 * serializes real Decimals and answers 200, and the second hands the serializer
 * a string and throws `price.lessThan is not a function`.
 *
 * That is exactly how the typeahead cache shipped, and a latency benchmark
 * called it a success because a 500 is very fast. Cache the finished payload
 * and a hit is byte-identical to a miss by construction. Where the value is
 * consumed as a Decimal rather than rendered — store settings feeding the
 * shipping quote — do not cache it at all.
 */

/**
 * Bumped when a cached value's *shape* changes.
 *
 * Without it, a deploy that adds a field to the category tree serves the old
 * shape from Redis until every key expires — a bug that only exists in
 * production, only for minutes, and looks exactly like a serializer failing.
 */
const VERSION = 'v1'

const key = (namespace: string, suffix: string) => `cache:${VERSION}:${namespace}:${suffix}`

/**
 * Fetch through the cache. On a miss, or on any Redis failure, `load` runs and
 * its result is returned — the write-back is best effort.
 *
 * `null` and `undefined` from `load` are returned but never stored: a missing
 * category should not be remembered as missing for fifteen minutes, and a
 * cached empty answer is how a transient failure becomes a persistent one.
 */
export async function cached<T>(
  namespace: string,
  suffix: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const cacheKey = key(namespace, suffix)

  try {
    const hit = await redis.get(cacheKey)
    if (hit !== null) return JSON.parse(hit) as T
  } catch (error) {
    // Once per outage is handled by the client's own listener; this stays debug
    // so a Redis blip does not bury the log in one line per request.
    logger.debug({ err: error, cacheKey }, 'cache read failed — falling through')
  }

  const value = await load()

  if (value !== null && value !== undefined) {
    try {
      await redis.set(cacheKey, JSON.stringify(value), 'EX', ttlSeconds)
    } catch (error) {
      logger.debug({ err: error, cacheKey }, 'cache write failed — value still returned')
    }
  }

  return value
}

/**
 * Drops every key in a namespace, for when a write makes them wrong before
 * their TTL would.
 *
 * `SCAN` rather than `KEYS`: this runs inside a request that just wrote a
 * product, and `KEYS` blocks the whole Redis server while it walks the
 * keyspace. Unlinked rather than deleted so the freeing happens off-thread.
 */
export async function invalidate(namespace: string): Promise<void> {
  const pattern = key(namespace, '*')

  try {
    let cursor = '0'
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      cursor = next
      if (found.length > 0) await redis.unlink(...found)
    } while (cursor !== '0')
  } catch (error) {
    /**
     * Swallowed, and this is the one that deserves a real log line: the cache
     * now holds values that are known to be wrong, and they will stay wrong
     * until their TTL. Every namespace here is given a TTL short enough that
     * this is a blemish rather than an incident — which is why none of them are
     * measured in hours.
     */
    logger.warn({ err: error, namespace }, 'cache invalidation failed — stale until TTL')
  }
}

/** Namespaces, in one place so a typo cannot silently create a second cache. */
export const CACHE = {
  categoryTree: 'category-tree',
  home: 'home',
  suggest: 'suggest',
  facets: 'facets',
} as const

/**
 * Everything derived from the catalogue's shape, dropped together.
 *
 * Deliberately coarse. A precise map from "which write invalidates which cache"
 * would be six rules that have to be revisited every time a serializer changes
 * — and the failure mode of getting one wrong is a customer looking at a
 * category that says 12 products and shows 11. These are cheap to rebuild;
 * being wrong is not cheap.
 */
export async function invalidateCatalog(): Promise<void> {
  await Promise.all([
    invalidate(CACHE.facets),
    invalidate(CACHE.categoryTree),
    invalidate(CACHE.home),
    invalidate(CACHE.suggest),
  ])
}
