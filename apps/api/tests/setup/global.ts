import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import {
  assertTestDatabase,
  MAINTENANCE_DATABASE_URL,
  TEST_DATABASE_NAME,
  TEST_DATABASE_URL,
} from './test-db.js'

/**
 * Runs once for the whole integration project: make sure the test database
 * exists, and that its schema is the one the migrations describe.
 *
 * Migrations rather than `db push`, deliberately. `push` would diff the Prisma
 * schema straight onto the database and produce a shape that no migration ever
 * produces — so the tests would pass against a schema production will never
 * have, and a broken migration would go unnoticed until deploy. Running the
 * real migration chain here means the chain itself is under test.
 */

const dbPackageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db',
)

async function ensureDatabaseExists(): Promise<void> {
  const client = new Client({ connectionString: MAINTENANCE_DATABASE_URL })
  await client.connect()

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE_NAME,
    ])
    // Identifier interpolation, which is safe only because the name is a
    // constant in this repo and never comes from input. `CREATE DATABASE`
    // cannot take a bind parameter for its name.
    if (rowCount === 0) await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`)
  } finally {
    await client.end()
  }
}

export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL)

  try {
    await ensureDatabaseExists()
  } catch (error) {
    throw new Error(
      `Could not reach Postgres at ${MAINTENANCE_DATABASE_URL.replace(/:[^:@]*@/, ':***@')}.\n` +
        `The integration tests need it running — try \`npm run services:up\`.\n` +
        `Original error: ${(error as Error).message}`,
    )
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  })
}
