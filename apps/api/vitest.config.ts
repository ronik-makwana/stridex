import { defineConfig } from 'vitest/config'

/**
 * Two projects, split by what they need to run rather than by what they cover.
 *
 * `unit` needs nothing: no Postgres, no Redis, no network. Every module it
 * imports is either pure or takes its dependencies as arguments, which is what
 * lets `npm run test:unit` pass on a laptop with docker stopped and in a CI job
 * with no service containers.
 *
 * `integration` needs a real Postgres, and needs one because the things it
 * covers cannot be faked: `SELECT … FOR UPDATE` under two concurrent
 * transactions, a unique index refusing a replayed webhook, a coupon evaluated
 * against rows. A mock of a row lock proves the mock locks.
 *
 * The split is enforced by the include globs, so a test that quietly starts
 * needing a database lands in the project that has one.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          /**
           * Runs before the test file is imported, which is the only moment
           * that works: `config/env.ts` validates at import time and throws on
           * anything missing, so the variables have to be in place before the
           * module graph loads.
           */
          setupFiles: ['./tests/setup/env.ts'],
          /**
           * `@shoe/db` is a symlinked workspace package whose entry point is a
           * `.ts` file. Externalised, Node would be handed TypeScript and fail
           * on the first type annotation; inlined, Vite transforms it.
           */
          server: { deps: { inline: ['@shoe/db'] } },
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // `db.ts` after `env.ts`: it overrides DATABASE_URL to point at the
          // test database, and must do so before anything opens a pool.
          setupFiles: ['./tests/setup/env.ts', './tests/setup/db.ts'],
          // Creates and migrates the database once for the whole run.
          globalSetup: ['./tests/setup/global.ts'],
          server: { deps: { inline: ['@shoe/db'] } },
          /**
           * One file at a time, in one process. These share a single database
           * and truncate between tests, so running two files in parallel would
           * have one wiping the rows the other is asserting on.
           *
           * `singleFork` rather than the root-level `fileParallelism`, which
           * cannot be set per project and would serialise the unit tests too.
           */
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          // Migrating and locking is slower than arithmetic.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/api/**/*.test.ts'],
          /**
           * Same database harness as `integration`, because these drive the
           * real router against real rows. What they add is everything between
           * the socket and the service: the auth wall, the validation
           * middleware, the error handler's status codes, and whether a route
           * is mounted where the client thinks it is.
           *
           * They need Redis as well as Postgres — `createApp()` mounts the
           * rate limiter, which is backed by it.
           */
          setupFiles: ['./tests/setup/env.ts', './tests/setup/db.ts'],
          globalSetup: ['./tests/setup/global.ts'],
          server: { deps: { inline: ['@shoe/db'] } },
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
