import 'dotenv/config'
import { logger } from '../lib/logger.js'
import { closeQueues } from '../lib/queue.js'
import { disconnectRedis } from '../lib/redis.js'
import { MAIL_PRIORITY } from '../lib/queue.js'
import { enqueueMail } from '../modules/mail/mail.service.js'

/**
 * Sends one test email through the real pipeline:
 *
 *   npm run mail:test -w apps/api -- you@example.com
 *
 * **Enqueues rather than sending**, which is the whole point and the difference
 * between this and `jobs/run.ts`. That one deliberately bypasses the queue
 * because it is testing a handler. This one is testing the pipe — enqueue,
 * worker, provider, inbox — so a run that succeeds while no worker is listening
 * would be a run that proved nothing.
 *
 * Which means: **start the worker first.** In development the API process is
 * the worker (`RUN_WORKER_INLINE`), so `npm run dev:api` is enough.
 */
const to = process.argv[2]

if (!to || !to.includes('@')) {
  console.log('Usage: npm run mail:test -w apps/api -- <email>')
  process.exit(1)
}

await enqueueMail(
  {
    template: 'mail.test',
    to,
    data: { note: `queued at ${new Date().toISOString()}` },
  },
  { priority: MAIL_PRIORITY.INTERACTIVE },
)

logger.info({ to }, 'test mail queued — check mailpit at http://localhost:8025')

await Promise.allSettled([closeQueues(), disconnectRedis()])
process.exit(0)
