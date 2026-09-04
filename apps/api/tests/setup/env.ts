/**
 * The environment every test runs against, applied before any module loads.
 *
 * `config/env.ts` validates at import time and throws on anything missing, so
 * a module that reads `env` — the token signer, the Razorpay provider, the
 * error handler — cannot be imported at all without this. That is the design
 * working as intended, and it is why this file exists rather than each test
 * setting the two variables it happens to need.
 *
 * Every value here is deliberately fake and deliberately *valid*: real enough
 * to satisfy the schema, useless enough that nothing can reach a real service
 * with it. The secrets are the length the schema demands and nothing more.
 */

// Points at a closed port. Unit tests never query — a `pg.Pool` does not dial
// until its first query — and the integration project overrides this with the
// real test database before it runs.
process.env.DATABASE_URL ??=
  'postgresql://unused:unused@127.0.0.1:1/unit_tests_never_connect'

process.env.NODE_ENV = 'test'

// 32 characters minimum, per the schema. Different from each other, because a
// test that passes with the two swapped would hide a real mix-up.
process.env.JWT_ACCESS_SECRET = 'test-access-secret-000000000000000000'
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-11111111111111111'
process.env.ACCESS_TOKEN_TTL = '15m'
process.env.REFRESH_TOKEN_TTL = '7d'

process.env.REDIS_URL ??= 'redis://127.0.0.1:6379'

/**
 * A `rzp_test_` prefix on purpose: `config/env.ts` refuses a `rzp_live_` key
 * outside production, and a test suite is exactly the place that guard should
 * hold. The webhook secret is the one that matters here — the signature tests
 * sign with it and expect the provider to verify against the same value.
 */
process.env.PAYMENT_PROVIDER = 'razorpay'
process.env.RAZORPAY_KEY_ID = 'rzp_test_unit'
process.env.RAZORPAY_KEY_SECRET = 'unit-test-key-secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-test-webhook-secret'

process.env.STOREFRONT_URL = 'http://localhost:5174'
process.env.ADMIN_URL = 'http://localhost:5175'

// Empty host selects the log provider, which renders and sends nothing.
process.env.SMTP_HOST = ''
process.env.MAIL_FROM = 'StrideX <no-reply@stridex.test>'

// Nothing in a test should start a worker or a scheduler.
process.env.RUN_WORKER_INLINE = 'false'
// `fatal`, not `silent`: pino accepts silent, but `config/env.ts` validates
// this against an enum that does not include it — and a test env that fails the
// app's own validation is not the env the app runs under.
process.env.LOG_LEVEL = 'fatal'
