import pino from 'pino'
import { env, isDevelopment } from '../config/env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'req.body.password',
      'req.body.newPassword',
      'req.body.token',
    ],
    remove: true,
  },
})
