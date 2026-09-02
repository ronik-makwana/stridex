import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isProduction } from './config/env.js'
import { logger } from './lib/logger.js'
import { globalLimiter } from './middleware/rateLimit.js'
import { readWorkerHealth } from './lib/queue.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { adminRouter } from './routes/admin.routes.js'
import { shopRouter } from './routes/shop.routes.js'
import { webhooksRouter } from './routes/webhooks.routes.js'

export function createApp(): Express {
  const app = express()

  // Behind nginx/Cloudflare in production: without this, `req.ip` is the proxy
  // and every rate limiter shares one bucket.
  app.set('trust proxy', isProduction ? 1 : false)
  app.disable('x-powered-by')

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, health checks, server-to-server.
        if (!origin) return callback(null, true)
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true)
        // Omit the headers rather than throwing: the browser blocks the response
        // either way, and throwing turns every probe into a logged 500.
        callback(null, false)
      },
      // Required for the refresh cookie to travel at all.
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      /**
       * `Idempotency-Key` has to be here or the browser's preflight rejects
       * every payment before it is sent — and curl, which does not preflight,
       * would never notice. A header the client must send is a header this list
       * must name.
       */
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      maxAge: 86_400,
    }),
  )

  /**
   * The raw bytes are kept for webhook routes only.
   *
   * A provider signs what it sent, byte for byte. Verifying against
   * `JSON.stringify(req.body)` verifies a re-serialisation — different key
   * order, different spacing, different number formatting — and a signature
   * check that passes on the wrong bytes is worse than none, because it looks
   * like security (§8).
   */
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/webhooks/')) {
          ;(req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
        }
      },
    }),
  )
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(cookieParser())

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
    }),
  )

  app.use(globalLimiter)

  /**
   * Reports the worker as well as itself. Before Phase 21 the API process *was*
   * the scheduler, so "the API is up" implied "the sweeps are running" — and
   * splitting the worker out broke that implication silently. `worker: stale`
   * is what makes a worker that died visible from the endpoint people already
   * check, rather than from stock that never gets released.
   *
   * Still a 200 either way: the API genuinely is serving, and flipping this to
   * a 500 would take healthy instances out of a load balancer over a
   * background job.
   */
  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      env: env.NODE_ENV,
      worker: await readWorkerHealth(),
    })
  })

  app.use('/api/admin', adminRouter)
  app.use('/api/storefront', shopRouter)

  /**
   * Outside both trees, and deliberately so: this is not a customer talking to
   * us, it is a payment provider — no session, no CORS, no rate limiter that
   * could drop a confirmation. Its only credential is the signature (§8).
   */
  app.use('/api/webhooks', webhooksRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
