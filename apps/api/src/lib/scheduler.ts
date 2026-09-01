import { logger } from './logger.js'

/**
 * The background jobs, on plain intervals.
 *
 * No cron library and no queue, deliberately: two jobs that each take
 * milliseconds and tolerate being skipped do not need one, and a scheduler with
 * its own storage is a second thing that can be down. When this outgrows a
 * single process — more than one API instance, and both sweeping — the answer
 * is a lock in Redis or a real scheduler, not a bigger interval.
 *
 * Every job here is safe to run twice and safe to miss: expiry re-checks the
 * deadline, reconciliation re-asks the provider, and both write conditionally.
 */

type Job = {
  name: string
  everyMs: number
  run: () => Promise<unknown>
}

const running = new Set<string>()

async function runOnce(job: Job) {
  // Overlap guard. A pass that is somehow still going must not have a second
  // one started on top of it — they would fight over the same rows.
  if (running.has(job.name)) {
    logger.warn({ job: job.name }, 'Skipped a run: the previous one is still going')
    return
  }
  running.add(job.name)
  try {
    await job.run()
  } catch (error) {
    // A job that throws must not take the process with it.
    logger.error({ err: error, job: job.name }, 'Background job failed')
  } finally {
    running.delete(job.name)
  }
}

export function startJobs(jobs: Job[]): () => void {
  const timers = jobs.map((job) => {
    // A small random offset so a restart of several instances does not put
    // every sweep on the same second.
    const jitter = Math.floor(Math.random() * 5_000)
    const timer = setInterval(() => void runOnce(job), job.everyMs + jitter)
    // The process should be able to exit without waiting for a timer.
    timer.unref()
    logger.info({ job: job.name, everyMs: job.everyMs }, 'Background job scheduled')
    return timer
  })

  return () => timers.forEach((timer) => clearInterval(timer))
}

export { runOnce }
export type { Job }
