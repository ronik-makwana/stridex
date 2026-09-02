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

// ─── mail ────────────────────────────────────────────────────────────────────

/**
 * One queue for every transactional email, not one per template.
 *
 * Per-job `priority` is what separates them instead. Verification and password
 * reset are interactive — somebody is on a screen waiting for the link — while
 * an order confirmation is not, and a shared FIFO would let a confirmation
 * backlog starve the link somebody is refreshing for.
 */
export const MAIL_QUEUE = 'mail'

/** Lower runs first, which is BullMQ's convention and the opposite of intuition. */
export const MAIL_PRIORITY = {
  /** A person is waiting on this link right now. */
  INTERACTIVE: 1,
  /** It should arrive; nobody is watching the clock. */
  BACKGROUND: 5,
} as const

const mailJobOptions: JobsOptions = {
  /**
   * Five attempts backing off from thirty seconds — roughly 30s, 1m, 2m, 4m.
   * Provider outages last minutes, so a tighter schedule would spend every
   * attempt inside the same outage and give up before it ended.
   */
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },

  /**
   * Completed jobs are discarded rather than kept, and this is the one place
   * where retention is a security decision rather than a housekeeping one.
   *
   * Verification and reset jobs must carry a **raw token** in their payload:
   * only the SHA-256 is stored, so the worker cannot re-derive it (Phase 23).
   * A kept completed job is that live credential sitting in Redis with no
   * expiry.
   */
  removeOnComplete: true,

  /**
   * Failed jobs are the ones worth inspecting, and also the ones holding that
   * same token — so they are kept by age, not forever. An hour is long enough
   * to diagnose a failure and short enough that a live token is not sitting
   * there overnight.
   */
  removeOnFail: { age: 3_600 },
}

export const mailQueue = new Queue(MAIL_QUEUE, {
  connection: createQueueConnection('mail-queue'),
  defaultJobOptions: mailJobOptions,
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

/** Shutdown. Closing a queue closes the connection it was handed. */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([maintenanceQueue.close(), mailQueue.close()])
}
