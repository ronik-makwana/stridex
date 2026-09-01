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

  /**
   * A starting vocabulary for the product editor's tag picker, which is
   * otherwise empty until somebody types the first one — and an empty
   * typeahead looks broken rather than new.
   *
   * These are not attached to any product. A tag is deleted once the last
   * product drops it, so one of these disappears after being used and then
   * removed; re-run this seed to put the list back.
   */
  const tags = [
    'waterproof',
    'breathable',
    'lightweight',
    'cushioned',
    'wide fit',
    'slip resistant',
    'vegan',
    'recycled materials',
    'running',
    'training',
    'trail',
    'casual',
    'limited edition',
    'new arrival',
  ]

  const { count } = await prisma.tag.createMany({
    // Slugs are unique, so re-running adds whatever is missing and leaves the
    // rest — including the counts, which live on the join table.
    data: tags.map((name) => ({ name, slug: name.replace(/\s+/g, '-') })),
    skipDuplicates: true,
  })

  console.log(`seeded ${count} tags (${tags.length - count} already present)`)

  /**
   * And put them on the catalogue, so the picker's counts and its use-first
   * ordering are showing something real rather than fourteen zeroes.
   *
   * Two sources, in this order: what a product's own title says about it — a
   * 'Trail Runner' is tagged trail and running — and then a deterministic
   * spread so every product carries at least two. Deterministic rather than
   * random, so re-running this seed does not reshuffle the whole catalogue.
   */
  const byTitle: [RegExp, string[]][] = [
    [/run|marathon|jog/i, ['running', 'lightweight']],
    [/trail|hik|trek|outdoor/i, ['trail', 'waterproof']],
    [/train|gym|cross|court/i, ['training', 'cushioned']],
    [/sandal|slipper|flip|slide|loafer|casual/i, ['casual', 'breathable']],
    [/boot|rain|storm|snow/i, ['waterproof', 'slip resistant']],
    [/canvas|sneaker|classic/i, ['casual', 'vegan']],
    [/kid|baby|infant|toddler|junior/i, ['lightweight', 'wide fit']],
  ]

  const products = await prisma.product.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: 'asc' },
  })
  const tagIds = new Map(
    (await prisma.tag.findMany({ select: { id: true, name: true } })).map((tag) => [
      tag.name,
      tag.id,
    ]),
  )

  const links: { productId: string; tagId: string }[] = []
  for (const [index, product] of products.entries()) {
    const names = new Set<string>()
    for (const [pattern, matched] of byTitle) {
      if (pattern.test(product.title)) for (const name of matched) names.add(name)
    }
    // The filler walks the list at a stride coprime with its length, so the
    // tags that titles never mention still land on a spread of products
    // rather than piling onto the first few.
    names.add(tags[index % tags.length]!)
    if (names.size < 2) names.add(tags[(index * 5 + 3) % tags.length]!)

    for (const name of names) {
      const tagId = tagIds.get(name)
      if (tagId) links.push({ productId: product.id, tagId })
    }
  }

  const linked = await prisma.productTag.createMany({ data: links, skipDuplicates: true })
  console.log(`tagged ${products.length} products: ${linked.count} new links`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
