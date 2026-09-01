import 'dotenv/config'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { runOnce } from '../lib/scheduler.js'
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

await runOnce(job)
logger.info({ job: job.name }, 'Job finished')
await prisma.$disconnect()
