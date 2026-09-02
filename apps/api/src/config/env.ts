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
   * Where the two SPAs actually live, for building links in email.
   *
   * `CORS_ORIGINS` is a list of who may call us and deliberately not this: it
   * has no canonical first entry, and a verification link that changed because
   * someone reordered an allowlist would be a very quiet bug. An email link is
   * absolute or it is broken, so these are required rather than derived.
   */
  STOREFRONT_URL: z.url(),
  ADMIN_URL: z.url(),

  /**
   * Outbound SMTP. Discrete fields rather than a URL because that is the shape
   * every provider documents — Resend gives you `smtp.resend.com:465`, Brevo
   * `smtp-relay.brevo.com:587` — and assembling a URL from them only to parse
   * it again is a round trip that can only lose.
   *
   * **An empty `SMTP_HOST` selects the log provider**, which renders the
   * message and sends nothing. That is the right default for tests and CI,
   * where no SMTP is listening, and it is why there is no separate
   * `MAIL_PROVIDER` switch to keep in step with it.
   */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('StrideX <no-reply@stridex.local>'),

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
  // The default sender is a .local address. Mail from it is not delivered, it
  // is silently dropped by the receiving side — the worst failure shape there
  // is, because every job reports success.
  .refine(
    (value) => value.NODE_ENV !== 'production' || !value.MAIL_FROM.includes('stridex.local'),
    { path: ['MAIL_FROM'], message: 'Set a real sending address in production' },
  )
  // Same failure shape from the other direction: with no host, production would
  // log every verification link and deliver none, and every job would succeed.
  .refine((value) => value.NODE_ENV !== 'production' || value.SMTP_HOST.length > 0, {
    path: ['SMTP_HOST'],
    message: 'Set an SMTP host in production, or no mail is actually sent',
  })
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
