import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end, against a stack this file starts and owns.
 *
 * Deliberately **not** the development stack. Pointing these at `localhost:4000`
 * would make them depend on whatever is in the dev database and would write
 * test rows into it — so the API here runs on its own port against `shoe_test`,
 * seeded to a known catalogue by `globalSetup`. Nothing outside `shoe_test` is
 * ever touched, and a developer can keep their own `npm run dev` running while
 * these execute.
 *
 * This is the layer that catches what the other three cannot: a route that does
 * not render, a bundle that fails to load, a fetch the browser blocks on CORS.
 * It is also the slowest and the most fragile, which is why the spec set is
 * small and each assertion waits on a real signal rather than a timeout.
 */

const API_PORT = 4001
const SHOP_PORT = 5273

const API_URL = `http://localhost:${API_PORT}`
const SHOP_URL = `http://localhost:${SHOP_PORT}`

/**
 * `??` is not enough for environment variables: an exported-but-empty variable
 * is `''`, not `undefined`, so the default would never apply. That surfaced as
 * a seed refusing to run against `""`.
 */
const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value : fallback
}

const TEST_DATABASE_URL = fromEnv(
  'TEST_DATABASE_URL',
  'postgresql://postgres:postgres@localhost:5433/shoe_test',
)

/** The same shape `apps/api/tests/setup/env.ts` uses, for the same reasons. */
const apiEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: fromEnv('REDIS_URL', 'redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: 'e2e-access-secret-0000000000000000000',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-111111111111111111',
  CORS_ORIGINS: SHOP_URL,
  STOREFRONT_URL: SHOP_URL,
  ADMIN_URL: 'http://localhost:5175',
  RAZORPAY_KEY_ID: 'rzp_test_e2e',
  RAZORPAY_KEY_SECRET: 'e2e-key-secret',
  RAZORPAY_WEBHOOK_SECRET: 'e2e-webhook-secret',
  SMTP_HOST: '',
  MAIL_FROM: 'StrideX <no-reply@stridex.test>',
  // No sweeps racing the assertions.
  RUN_WORKER_INLINE: 'false',
  LOG_LEVEL: 'warn',
}

export default defineConfig({
  testDir: './specs',
  // One at a time. They share a database and a seeded catalogue.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  globalSetup: './global-setup.ts',

  use: {
    baseURL: SHOP_URL,
    // Kept only for a failure, which is the only time anybody looks.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Playwright starts both and waits for each to answer before any spec runs.
   * `reuseExistingServer` is off in CI so a stale process cannot make a broken
   * build look green, and on locally so re-running is fast.
   */
  webServer: [
    {
      command: 'npm run dev -w apps/api',
      cwd: '..',
      url: `${API_URL}/health`,
      env: apiEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -w apps/storefront -- --port ${SHOP_PORT} --strictPort`,
      cwd: '..',
      url: SHOP_URL,
      env: {
        ...process.env,
        VITE_API_URL: `${API_URL}/api/storefront`,
        VITE_API_ORIGIN: API_URL,
        VITE_SITE_URL: SHOP_URL,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
