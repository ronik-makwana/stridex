import 'dotenv/config'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { disconnectRedis } from './lib/redis.js'
import { closeQueues } from './lib/queue.js'
import { ensureBucket } from './config/minio.js'
import { startWorker } from './worker.js'

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
 * The background worker, in-process, for development only — see
 * `RUN_WORKER_INLINE`. Started here rather than inside the app so that a test
 * importing `createApp()` does not quietly acquire one.
 *
 * In production the worker is a separate process (`npm run worker`), so this
 * resolves to a no-op and the API only ever produces jobs.
 */
let stopWorker: (() => Promise<void>) | undefined
if (env.RUN_WORKER_INLINE) {
  stopWorker = await startWorker()
  logger.info('worker running inline — set RUN_WORKER_INLINE=false to split it out')
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  // Before the connections close: an in-flight sweep finishes rather than
  // being severed halfway through a transaction.
  await stopWorker?.()
  // `void` on an inner call rather than an async callback: `server.close`
  // expects a void-returning function and would drop the promise, so a
  // rejection in here would surface as an unhandled rejection during shutdown
  // — the one moment nothing is left to report it.
  server.close(() => {
    void Promise.allSettled([closeQueues(), prisma.$disconnect(), disconnectRedis()]).then(() =>
      process.exit(0),
    )
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
