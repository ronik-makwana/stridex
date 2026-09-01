import { sweepExpiredSessions, sweepOrphanedHolds } from '../modules/checkout/expiry.service.js'
import { reconcilePendingPayments } from '../modules/payments/reconcile.service.js'
import type { Job } from '../lib/scheduler.js'

/**
 * Every recurring job in the system, in one list so that "what runs in the
 * background" is a question with a file for an answer.
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
