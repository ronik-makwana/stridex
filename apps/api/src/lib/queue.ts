import { Queue, type JobsOptions } from 'bullmq'
import { createQueueConnection, redis } from './redis.js'

/**
 * The background job system: the queues themselves, and nothing about what
 * runs on them. `jobs/index.ts` stays the one list of *what* runs; this file
 * is only *how* it runs.
 *
 * Importing this module opens a Redis connection, so it is imported by the
 * worker and by whatever needs to enqueue — not by modules that merely might.
 */

/**
 * One queue for the recurring maintenance sweeps. They have the same shape and
 * the same failure policy, so splitting them would buy two of everything and
 * no isolation worth having. Phase 22's `mail` is a separate queue because it
 * genuinely differs: priorities, real retries, an external dependency.
 */
export const MAINTENANCE_QUEUE = 'maintenance'

/**
 * `checkout.expiry` alone produces 1,440 jobs a day. Without retention limits
 * the completed set grows until Redis is full of receipts for sweeps that found
 * nothing.
 */
const maintenanceJobOptions: JobsOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  /**
   * One attempt, and the schedule is the retry.
   *
   * Both maintenance jobs run again in sixty seconds or five minutes and both
   * are idempotent, so retrying a failed sweep five seconds later adds a second
   * failure to the log and nothing else. The `mail` queue in Phase 22 is where
   * `attempts` earns its keep — there, a dropped job is a customer who never
   * gets their email, not a sweep that runs again shortly.
   */
  attempts: 1,
}

export const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, {
  connection: createQueueConnection('maintenance-queue'),
  defaultJobOptions: maintenanceJobOptions,
})

// ─── worker liveness ─────────────────────────────────────────────────────────

/**
 * Until now "the API is up" implied "the sweeps are running", because the API
 * process *was* the scheduler. Splitting the worker out breaks that, and a
 * worker that is quietly down holds stock for every abandoned checkout until
 * somebody notices.
 *
 * So the worker leaves a key with a TTL and the API's `/health` reports it. The
 * question "is anything releasing held stock right now?" stays answerable from
 * the endpoint people already curl, with no second HTTP server to run.
 */
const HEARTBEAT_KEY = 'worker:heartbeat'

/** Comfortably longer than the beat interval, so one slow tick is not an alarm. */
const HEARTBEAT_TTL_SECONDS = 90
export const HEARTBEAT_INTERVAL_MS = 30_000

export async function writeHeartbeat(): Promise<void> {
  // The main client, not a queue connection: a heartbeat that hangs is worse
  // than a heartbeat that fails, and `redis` is the one tuned to give up.
  await redis.set(HEARTBEAT_KEY, new Date().toISOString(), 'EX', HEARTBEAT_TTL_SECONDS)
}

export type WorkerHealth = { status: 'alive'; since: string } | { status: 'stale' }

/**
 * `stale` covers both "the worker is down" and "Redis is down", and does not
 * try to tell them apart — from the caller's side the actionable fact is the
 * same: nothing can be assumed to be sweeping.
 */
export async function readWorkerHealth(): Promise<WorkerHealth> {
  try {
    const beat = await redis.get(HEARTBEAT_KEY)
    return beat ? { status: 'alive', since: beat } : { status: 'stale' }
  } catch {
    return { status: 'stale' }
  }
}

/** Shutdown. Closing the queue closes the connection it was handed. */
export async function closeQueues(): Promise<void> {
  await maintenanceQueue.close()
}
