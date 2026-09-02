import { sweepExpiredSessions, sweepOrphanedHolds } from '../modules/checkout/expiry.service.js'
import { reconcilePendingPayments } from '../modules/payments/reconcile.service.js'

/**
 * A recurring background job.
 *
 * Every job here must be **safe to run twice and safe to miss**. That was true
 * when a `setInterval` drove them and it is still true now that BullMQ does:
 * the job scheduler produces one job per interval across the whole cluster, but
 * a sweep that outruns its own interval can still overlap with the next one on
 * another worker. Expiry re-checks the deadline and reconciliation re-asks the
 * provider, so both write conditionally and neither cares.
 */
export type Job = {
  name: string
  everyMs: number
  run: () => Promise<unknown>
}

/**
 * Every recurring job in the system, in one list so that "what runs in the
 * background" is a question with a file for an answer.
 *
 * This array is the source of truth in **both** directions. The worker upserts
 * a scheduler for everything here on boot, and deletes any scheduler in Redis
 * that is no longer here — otherwise removing a job from this file would leave
 * it firing forever against a handler that no longer exists.
 */
export const jobs: Job[] = [
  {
    name: 'checkout.expiry',
    /**
     * A minute. The TTL is ten, and lazy expiry already covers every session
     * somebody looks at — this only has to catch the abandoned ones, and the
     * cost of catching them a minute late is a minute of held stock.
     */
    everyMs: 60_000,
    run: async () => {
      const expired = await sweepExpiredSessions()
      const orphans = await sweepOrphanedHolds()
      return { ...expired, ...orphans }
    },
  },
  {
    name: 'payments.reconcile',
    /** Five minutes, as specified. It only looks at payments already 10 minutes old. */
    everyMs: 5 * 60_000,
    run: () => reconcilePendingPayments(),
  },
]

export const jobsByName = new Map(jobs.map((job) => [job.name, job]))
