import { afterAll, beforeEach } from 'vitest'
import { assertTestDatabase, TEST_DATABASE_URL } from './test-db.js'

/**
 * Points this worker at the test database, then empties it before every test.
 *
 * The assignment has to happen *here*, in a setup file, rather than in a
 * `beforeAll`: `packages/db/src/client.ts` reads `DATABASE_URL` at import time
 * and builds its pool from it, and by the time a hook runs the module graph has
 * already loaded. Setup files run before the test file is imported, which is
 * the only window where this still has an effect.
 */
assertTestDatabase(TEST_DATABASE_URL)
process.env.DATABASE_URL = TEST_DATABASE_URL

// Imported *after* the assignment above, so the client it builds connects to
// the test database rather than to whatever `env.ts` left in place.
const { prisma } = await import('@shoe/db')

/**
 * Every table, discovered rather than listed.
 *
 * A hand-written list is a list somebody forgets to update — and the failure is
 * not a broken test, it is a table that quietly keeps its rows between cases
 * until one test starts depending on another's data.
 */
let tables: string[] | undefined

async function tableNames(): Promise<string[]> {
  tables ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((row) => row.tablename)
  return tables
}

/**
 * One statement for all of them. Truncating tables one at a time would trip
 * over foreign keys in whatever order they came back; `CASCADE` in a single
 * `TRUNCATE` empties the graph at once.
 *
 * `RESTART IDENTITY` resets the serial columns, so ids do not creep upward
 * across a run and a test asserting on a generated value stays stable.
 */
export async function truncateAll(): Promise<void> {
  const names = await tableNames()
  if (names.length === 0) return

  const quoted = names.map((name) => `"public"."${name}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`)

  // Not covered by RESTART IDENTITY: it is a standalone sequence, not one owned
  // by a column, and order numbers would otherwise climb across the whole run.
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE order_number_seq RESTART WITH 1000`)
}

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await prisma.$disconnect()
})
