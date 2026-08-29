import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/client.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

// Explicit pool settings. The defaults are fine until the first traffic spike,
// and by then you are debugging under load.
const adapter = new PrismaPg({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })

// tsx watch reloads the module graph on every save; without this the pool leaks.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
