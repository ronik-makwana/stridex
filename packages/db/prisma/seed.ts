import 'dotenv/config'
import argon2 from 'argon2'
import { prisma } from '../src/client.js'
import { UserRole, UserStatus } from '../src/generated/enums.js'

// argon2id, tuned for a login endpoint: ~64 MB, 3 passes. Must match the
// hashing options in apps/api so rehash-on-login is not triggered every time.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@shoe.com').toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345'

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
      firstName: 'Store',
      lastName: 'Owner',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  })

  console.log(`seeded admin ${admin.email} (${admin.id})`)
  console.log(`password: ${password}`)

  if (process.env.NODE_ENV === 'production') return

  // Dev-only fixtures. The admin login has three ways to say no, and each needs
  // an account to say it about: wrong audience, suspended, and correct.
  const fixtureHash = await argon2.hash('Customer@12345', ARGON2_OPTIONS)

  await prisma.user.upsert({
    where: { email: 'shopper@shoe.com' },
    update: {},
    create: {
      email: 'shopper@shoe.com',
      passwordHash: fixtureHash,
      firstName: 'Sam',
      lastName: 'Shopper',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    },
  })

  await prisma.user.upsert({
    where: { email: 'benched@shoe.com' },
    update: { status: UserStatus.SUSPENDED },
    create: {
      email: 'benched@shoe.com',
      passwordHash: fixtureHash,
      firstName: 'Sus',
      lastName: 'Pended',
      role: UserRole.STAFF,
      status: UserStatus.SUSPENDED,
    },
  })

  console.log('seeded dev fixtures: shopper@shoe.com (CUSTOMER), benched@shoe.com (SUSPENDED STAFF)')
  console.log('fixture password: Customer@12345')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
