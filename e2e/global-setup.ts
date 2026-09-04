import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

/**
 * Runs once, before Playwright starts the servers: make sure `shoe_test`
 * exists, is migrated, and holds the seeded catalogue.
 *
 * Before the servers, and that ordering is the point — the API reads its schema
 * on first query, so seeding after boot would race the first page load.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

const MAINTENANCE_URL = TEST_DATABASE_URL.replace(/\/shoe_test$/, '/postgres')

async function ensureDatabase(): Promise<void> {
  const client = new Client({ connectionString: MAINTENANCE_URL })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      'shoe_test',
    ])
    if (rowCount === 0) await client.query('CREATE DATABASE "shoe_test"')
  } finally {
    await client.end()
  }
}

export default async function globalSetup(): Promise<void> {
  if (!TEST_DATABASE_URL.endsWith('/shoe_test')) {
    throw new Error(`Refusing to run e2e against "${TEST_DATABASE_URL}".`)
  }

  try {
    await ensureDatabase()
  } catch (error) {
    throw new Error(
      'The e2e suite needs Postgres running — try `npm run services:up`.\n' +
        `Original error: ${(error as Error).message}`,
    )
  }

  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.join(root, 'packages/db'),
    env,
    stdio: 'pipe',
  })

  execFileSync('npx', ['tsx', 'e2e/seed.ts'], { cwd: root, env, stdio: 'pipe' })
}
