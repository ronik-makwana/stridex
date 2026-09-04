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
  /**
   * Where browsers reach the objects, **including the bucket segment** if the
   * host uses one. Split from S3_ENDPOINT because in production the API talks
   * to storage over one address while the <img> tags point at another.
   *
   * The bucket is part of this value rather than appended to it, because the
   * two shapes genuinely differ and neither is derivable from the other:
   *
   *   MinIO / R2 S3 endpoint  https://host/stridex/products/x.jpg
   *   R2 public bucket        https://pub-<id>.r2.dev/products/x.jpg
   *
   * Defaulted to `S3_ENDPOINT/S3_BUCKET`, which is the path-style form MinIO
   * serves — so development needs no setting at all.
   */
  S3_PUBLIC_URL: z.string().optional(),

  /**
   * The bucket already exists and this process must not try to manage it.
   *
   * Every hosted S3 lookalike worth using on a free plan — R2, Supabase,
   * Backblaze — refuses `PutBucketPolicy`; R2 does not implement it at all.
   * `ensureBucket` would throw on the policy call, and because uploads await
   * it, every upload would fail with an error about bucket administration
   * rather than about the upload.
   *
   * So on those hosts you create the bucket once in their dashboard, make it
   * publicly readable there, and set this. MinIO in development leaves it off
   * and keeps creating and configuring its own bucket on boot.
   */
  S3_MANAGED_BUCKET: z.stringbool().default(false),

  /**
   * Required, like DATABASE_URL. Redis is infrastructure, not an enhancement:
   * the rate limiters share their counters through it and the job runtime will
   * not start without it. An API that boots with it missing is an API whose
   * login limit silently means something different per process — better to
   * fail at boot, where the message says so, than at 3am in a log nobody reads.
   */
  REDIS_URL: z.string().min(1),

  /**
   * Which provider `POST /payments` uses for **new** attempts.
   *
   * Only new ones. Refunds and reconciliation resolve their provider from the
   * row (`getProvider(payment.provider)`), so this never decides how an
   * existing payment is settled. It is a one-value enum today and stays an
   * enum: adding a second provider should be a change here and a line in the
   * registry, not a change of shape.
   */
  PAYMENT_PROVIDER: z.enum(['razorpay']).default('razorpay'),

  /**
   * Razorpay. Required by the refine below rather than at the schema level, so
   * that the failure names all three variables at once instead of stopping at
   * whichever happens to be parsed first.
   *
   * `RAZORPAY_KEY_ID` is the only one of the three that reaches a browser: it
   * rides down in `clientPayload` because Razorpay's checkout script needs it.
   * The other two never leave this process.
   */
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  /**
   * Set on the webhook in the Razorpay dashboard, and **not** the same string
   * as the key secret. Signing with the wrong one of the two fails every
   * webhook with a 401 that looks exactly like an attack.
   */
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  /**
   * What the customer reads at the top of the Razorpay modal. Their own
   * business name, not ours to guess.
   */
  RAZORPAY_DISPLAY_NAME: z.string().default('StrideX'),

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
  /**
   * Razorpay without its credentials is a checkout that fails at the first Pay,
   * on a 401 from an API nobody has logged into. Fail at boot, where the
   * message names the variables.
   */
  .refine(
    (value) =>
      value.RAZORPAY_KEY_ID.length > 0 &&
      value.RAZORPAY_KEY_SECRET.length > 0 &&
      value.RAZORPAY_WEBHOOK_SECRET.length > 0,
    {
      path: ['RAZORPAY_KEY_ID'],
      message:
        'Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET',
    },
  )
  /**
   * Live keys are `rzp_live_*`. Running them outside production is how a real
   * card gets charged for a test, and the mistake is silent — the payment
   * succeeds.
   */
  .refine(
    (value) => value.NODE_ENV === 'production' || !value.RAZORPAY_KEY_ID.startsWith('rzp_live_'),
    { path: ['RAZORPAY_KEY_ID'], message: 'That is a live key. Use rzp_test_* outside production' },
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
  S3_PUBLIC_URL:
    parsed.data.S3_PUBLIC_URL ||
    `${parsed.data.S3_ENDPOINT.replace(/\/+$/, '')}/${parsed.data.S3_BUCKET}`,
}
export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
