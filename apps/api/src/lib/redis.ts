// Named, not default: under `module: NodeNext` the default import of a CJS
// package resolves to the namespace object, which is not constructable.
import { Redis, type RedisOptions } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from './logger.js'

/**
 * The Redis connection. One client for the process, one import site, the same
 * shape as `lib/prisma.ts`.
 *
 * `REDIS_URL` is **required** — `config/env.ts` refuses to boot without it — so
 * nothing downstream needs a null check or a fallback path. A missing Redis is
 * a deployment that is wrong, not a mode this code supports.
 *
 * Redis being *configured* and Redis being *reachable* are still different
 * questions, and only the first one is settled here. The connection drops, and
 * what each caller does about that is the caller's decision: the rate limiters
 * let the request through and log it, and the queue (Phase 21) will retry.
 */

const options: RedisOptions = {
  /**
   * The offline queue stays **on**, which is the default and, after one attempt
   * at being clever, demonstrably the right call.
   *
   * Turning it off looks correct — why queue a command against a socket that is
   * down — but it breaks startup: `RedisStore.init()` issues a `SCRIPT LOAD` the
   * moment a limiter is constructed at import time, which is before the socket
   * has finished connecting, and with no offline queue that throws and every
   * limiter boots storeless.
   *
   * `commandTimeout` provides the property the queue was being disabled for: a
   * command against a dead Redis rejects in a second instead of waiting on a
   * reconnect that may never come.
   */
  commandTimeout: 1_000,
  maxRetriesPerRequest: 2,
  /**
   * Reconnect forever, backing off to ten seconds. Redis coming back must not
   * need a deploy — and `retryStrategy` returning null would stop trying for
   * the life of the process.
   */
  retryStrategy: (times) => Math.min(times * 200, 10_000),
  connectionName: 'stridex-api',
}

export const redis = new Redis(env.REDIS_URL, options)

/**
 * Logged once per outage, not once per retry. ioredis emits `error` on every
 * reconnect attempt, and a Redis down for an hour would otherwise write several
 * hundred identical lines and bury everything else.
 *
 * Without an `error` listener at all, ioredis emits on the process, and an
 * unhandled 'error' event ends it — so this listener is load-bearing, not
 * decoration.
 */
let down = false
redis.on('error', (error: Error) => {
  if (down) return
  down = true
  logger.error({ err: error }, 'redis unreachable')
})
redis.on('ready', () => {
  logger.info(down ? 'redis recovered' : 'redis ready')
  down = false
})

/** Closes the connection on shutdown. Never throws; a shutdown path must not. */
export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit()
  } catch {
    redis.disconnect()
  }
}
