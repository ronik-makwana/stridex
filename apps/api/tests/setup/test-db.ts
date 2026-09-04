/**
 * Where the integration tests point, in one place so the global setup that
 * creates the database and the per-file setup that connects to it cannot
 * disagree.
 *
 * **A separate database, never the development one.** These tests truncate
 * every table between cases, and pointing them at `shoe` would delete the
 * catalogue somebody spent an afternoon filling. The name is the guard: the
 * harness refuses to run against a database whose name is not this one.
 */

/**
 * `??` is not enough for environment variables.
 *
 * An exported-but-empty variable — `export TEST_DATABASE_URL=` in a shell, or a
 * CI runner that defines every key whether or not it has a value — is `''`, not
 * `undefined`, so `??` keeps the empty string and the default never applies.
 * That surfaced here as a seed refusing to run against `""`.
 */
const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value : fallback
}

const HOST = fromEnv('TEST_DATABASE_HOST', 'localhost')
const PORT = fromEnv('TEST_DATABASE_PORT', '5433')
const USER = fromEnv('TEST_DATABASE_USER', 'postgres')
const PASSWORD = fromEnv('TEST_DATABASE_PASSWORD', 'postgres')

export const TEST_DATABASE_NAME = 'shoe_test'

/** The database the tests run in. Created by `global.ts` if it is not there. */
export const TEST_DATABASE_URL = fromEnv(
  'TEST_DATABASE_URL',
  `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${TEST_DATABASE_NAME}`,
)

/**
 * The maintenance connection, used only to `CREATE DATABASE`. A database
 * cannot be created from inside itself, so this points at the always-present
 * `postgres` database on the same server.
 */
export const MAINTENANCE_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/postgres`

/**
 * The last line of defence before anything destructive runs.
 *
 * Called by both the global setup and the per-test truncate. If the URL in
 * play does not name the test database, something has gone wrong in a way that
 * ends with somebody's data deleted — so it throws rather than continues.
 */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '')
  if (name !== TEST_DATABASE_NAME) {
    throw new Error(
      `Refusing to run integration tests against "${name}". ` +
        `They truncate every table and must only ever point at "${TEST_DATABASE_NAME}".`,
    )
  }
}
