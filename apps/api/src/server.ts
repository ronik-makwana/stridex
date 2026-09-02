import 'dotenv/config'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { disconnectRedis } from './lib/redis.js'
import { ensureBucket } from './config/minio.js'
import { startJobs } from './lib/scheduler.js'
import { jobs } from './jobs/index.js'

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info(`api listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`)
})

// Create the bucket up front so the first upload is not the thing that
// discovers storage is missing. Not fatal: the API serves every other route
// fine without it, and `uploadObject` retries the check on each attempt.
void ensureBucket()
  .then(() => logger.info({ bucket: env.S3_BUCKET }, 'object storage ready'))
  .catch((error) => logger.error({ err: error }, 'object storage unavailable — uploads will fail'))

/**
 * Expiry and reconciliation. Started here rather than inside the app so that a
 * test importing `createApp()` does not quietly acquire a scheduler, and so an
 * operator can run the same jobs from cron instead — see src/jobs/run.ts.
 */
const stopJobs = startJobs(jobs)

async function shutdown(signal: string) {
  stopJobs()
  logger.info({ signal }, 'shutting down')
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), disconnectRedis()])
    process.exit(0)
  })
  // Do not let a hung connection hold the process open forever.
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandled rejection')
  process.exit(1)
})
