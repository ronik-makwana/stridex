import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isProduction } from './config/env.js'
import { logger } from './lib/logger.js'
import { globalLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { adminRouter } from './routes/admin.routes.js'

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
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  )

  app.use(express.json({ limit: '1mb' }))
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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: env.NODE_ENV })
  })

  app.use('/api/admin', adminRouter)
  // app.use('/api/storefront', shopRouter)   ← Part C

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
