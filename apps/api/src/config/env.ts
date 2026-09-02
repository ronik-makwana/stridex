import { z } from 'zod'

// Fail at boot, not at the first request that needs a missing secret.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  // Object storage (MinIO in development, any S3-compatible host in production).
  S3_ENDPOINT: z.url().default('http://localhost:9000'),
  S3_BUCKET: z.string().min(1).default('stridex'),
  S3_ACCESS_KEY: z.string().min(1).default('minio'),
  S3_SECRET_KEY: z.string().min(1).default('minio123'),
  S3_REGION: z.string().default('us-east-1'),
  // Where browsers reach the objects. Split from S3_ENDPOINT because in
  // production the API talks to storage over a private address while the
  // <img> tags point at a CDN.
  S3_PUBLIC_URL: z.string().optional(),

  /**
   * Required, like DATABASE_URL. Redis is infrastructure, not an enhancement:
   * the rate limiters share their counters through it and the job runtime will
   * not start without it. An API that boots with it missing is an API whose
   * login limit silently means something different per process — better to
   * fail at boot, where the message says so, than at 3am in a log nobody reads.
   */
  REDIS_URL: z.string().min(1),

  /**
   * Which provider `POST /payments` uses. 'mock' is a real implementation of
   * the same interface Razorpay will use — it signs its webhooks with the same
   * HMAC-SHA256 scheme, so `verifySignature` is exercised long before real
   * money is involved.
   */
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  /**
   * The mock's webhook secret. Defaulted in development because a provider
   * nobody can run is a provider nobody tests; production must set it, and the
   * refine below is what makes that non-optional.
   */
  PAYMENT_MOCK_SECRET: z.string().min(16).default('mock_webhook_secret_change_me'),

  /**
   * Runs the background worker inside the API process.
   *
   * Defaulted on in development so `npm run dev` stays one command, and off
   * elsewhere: in production the worker is its own deployment, and an API that
   * quietly also processes jobs makes "how many workers are running?" a
   * question you answer by counting API instances.
   */
  RUN_WORKER_INLINE: z
    .stringbool()
    .default(process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

const parsed = envSchema
  // A default secret is a convenience in development and a vulnerability in
  // production: anyone who has read this file could forge a paid webhook.
  .refine(
    (value) =>
      value.NODE_ENV !== 'production' || value.PAYMENT_MOCK_SECRET !== 'mock_webhook_secret_change_me',
    { path: ['PAYMENT_MOCK_SECRET'], message: 'Set a real webhook secret in production' },
  )
  .safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  throw new Error(`Invalid environment:\n${issues}`)
}

export const env = {
  ...parsed.data,
  S3_PUBLIC_URL: parsed.data.S3_PUBLIC_URL || parsed.data.S3_ENDPOINT,
}
export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
