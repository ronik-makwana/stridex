import 'dotenv/config'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { disconnectRedis } from '../lib/redis.js'
import { closeQueues } from '../lib/queue.js'
import { jobs, jobsByName } from './index.js'

/**
 * One job, once, from the command line:
 *
 *   npm run job -w apps/api -- checkout.expiry
 *
 * Exists for two reasons. A test needs to trigger a sweep deterministically
 * rather than waiting a minute for one. And an operator who would rather run
 * these from a real cron — or from a container that is not the API — can,
 * without the API process having to be the scheduler.
 *
 * **Runs the handler directly, not through the queue.** Enqueuing here would
 * mean this command did nothing unless a worker happened to be listening, and
 * would report success for work that had not started. The handler is the thing
 * being tested; the queue is how it is scheduled the rest of the time.
 */
const name = process.argv[2]

if (!name) {
  console.log(`Usage: tsx src/jobs/run.ts <job>\n\nJobs:\n${jobs.map((job) => `  ${job.name}`).join('\n')}`)
  process.exit(1)
}

const job = jobsByName.get(name)
if (!job) {
  console.error(`Unknown job "${name}". Known: ${[...jobsByName.keys()].join(', ')}`)
  process.exit(1)
}

const startedAt = Date.now()
try {
  const result = await job.run()
  logger.info({ job: job.name, ms: Date.now() - startedAt, result }, 'Job finished')
} catch (error) {
  // A non-zero exit, unlike the worker: a person or a cron is watching this one
  // and needs to know it failed.
  logger.error({ err: error, job: job.name }, 'Job failed')
  await Promise.allSettled([closeQueues(), prisma.$disconnect(), disconnectRedis()])
  process.exit(1)
}

await Promise.allSettled([closeQueues(), prisma.$disconnect(), disconnectRedis()])
