import 'dotenv/config'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { ensureBucket } from './config/minio.js'

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

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close(async () => {
    await prisma.$disconnect()
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
