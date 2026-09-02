import 'dotenv/config'
import { Worker } from 'bullmq'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { createQueueConnection, disconnectRedis } from './lib/redis.js'
import {
  HEARTBEAT_INTERVAL_MS,
  MAINTENANCE_QUEUE,
  closeQueues,
  maintenanceQueue,
  writeHeartbeat,
} from './lib/queue.js'
import { jobs, jobsByName } from './jobs/index.js'

/**
 * The background worker, run as its own process beside `server.ts`.
 *
 * What this replaces: a `setInterval` in every API process, which meant N
 * instances ran N sweeps per interval and fought over the same rows. A BullMQ
 * job scheduler produces one job per interval for the whole cluster, however
 * many workers are listening — which is why there is no Redis lock anywhere in
 * this codebase, and why one should not be added.
 *
 * In development this is started inside the API process (see
 * `RUN_WORKER_INLINE`) so `npm run dev` stays one command. In production it is
 * a separate deployment.
 */

/**
 * Reconciles Redis against `jobs/index.ts`, in both directions.
 *
 * Upsert covers the forward direction, including a changed `everyMs`: the
 * scheduler is keyed by name, so editing an interval updates it on next boot
 * rather than leaving two.
 *
 * The reverse direction is the one that is easy to forget and impossible to
 * notice. A scheduler lives in Redis, not in the code — so deleting a job from
 * the registry leaves it firing forever, producing jobs for a handler that no
 * longer exists, and the only symptom is a slow trickle of failures.
 */
async function syncSchedulers(): Promise<void> {
  for (const job of jobs) {
    await maintenanceQueue.upsertJobScheduler(job.name, { every: job.everyMs }, { name: job.name })
    logger.info({ job: job.name, everyMs: job.everyMs }, 'job scheduler registered')
  }

  const registered = await maintenanceQueue.getJobSchedulers()
  for (const scheduler of registered) {
    if (scheduler.key && !jobsByName.has(scheduler.key)) {
      await maintenanceQueue.removeJobScheduler(scheduler.key)
      logger.warn({ job: scheduler.key }, 'removed a scheduler with no job in the registry')
    }
  }
}

export async function startWorker(): Promise<() => Promise<void>> {
  await syncSchedulers()

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      const definition = jobsByName.get(job.name)
      /**
       * Thrown, not logged and swallowed. A job with no handler means Redis and
       * the registry disagree in a way `syncSchedulers` did not catch, and a
       * failure that shows up in the failed set is how anyone finds out.
       */
      if (!definition) throw new Error(`No handler registered for job "${job.name}"`)

      const startedAt = Date.now()
      const result = await definition.run()
      logger.info({ job: job.name, ms: Date.now() - startedAt, result }, 'job finished')
      return result
    },
    {
      connection: createQueueConnection('maintenance-worker'),
      /**
       * One at a time. It does not make overlap impossible — two workers can
       * still each pick up a sweep — but it keeps a single worker from stacking
       * them, and every job here is documented as safe to run twice anyway.
       */
      concurrency: 1,
    },
  )

  // A worker that throws on a job must not take the process with it. BullMQ has
  // already recorded the failure by the time this fires; this is the log line.
  worker.on('failed', (job, error) => {
    logger.error({ err: error, job: job?.name }, 'background job failed')
  })
  worker.on('error', (error) => {
    logger.error({ err: error }, 'worker error')
  })

  await writeHeartbeat()
  const heartbeat = setInterval(() => {
    void writeHeartbeat().catch((error) => logger.error({ err: error }, 'heartbeat write failed'))
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  logger.info({ queue: MAINTENANCE_QUEUE, jobs: jobs.map((job) => job.name) }, 'worker started')

  return async () => {
    clearInterval(heartbeat)
    // Waits for the job in flight rather than severing it mid-sweep.
    await worker.close()
  }
}

/**
 * Only when run directly. Imported by `server.ts` for the inline case, where
 * that process owns the lifecycle and must not get a second set of signal
 * handlers or a second `prisma.$disconnect()`.
 */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const stop = await startWorker()

  async function shutdown(signal: string) {
    logger.info({ signal }, 'worker shutting down')
    await stop()
    await Promise.allSettled([closeQueues(), prisma.$disconnect(), disconnectRedis()])
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection')
    process.exit(1)
  })
}
