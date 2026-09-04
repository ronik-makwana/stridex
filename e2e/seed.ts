import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../packages/db/src/generated/client.js'

/**
 * The catalogue the browser tests shop in.
 *
 * Small and fixed on purpose. An end-to-end test that asserts "a product grid
 * appears" against whatever happens to be in the database passes for the wrong
 * reason the day somebody archives the last product — so these tests get their
 * own handful of rows, with slugs and prices the specs can name.
 *
 * It writes to `shoe_test`, never to the development database. The guard in
 * `apps/api/tests/setup/test-db.ts` says the same thing for the API tests; this
 * repeats it because this file runs from a different entry point.
 */

/**
 * Both the guard and the client are built inside `seed()`, never at module
 * scope, and that is load-bearing rather than stylistic.
 *
 * `specs/storefront.spec.ts` imports `CATALOG` from this file so the specs and
 * the seed cannot drift. Playwright evaluates a spec's imports when it collects
 * tests — long before `globalSetup` has run and with none of its environment —
 * so a top-level `throw` here made every spec fail to load, reported as the
 * baffling pair "Refusing to run" followed by "No tests found".
 *
 * Anything at module scope in this file runs during test collection. Keep it to
 * data.
 */
let client: PrismaClient | undefined

function connect(): PrismaClient {
  const url = process.env.DATABASE_URL ?? ''

  // The guard, at the moment it can actually be evaluated.
  if (!url.endsWith('/shoe_test')) {
    throw new Error(`The e2e seed writes to shoe_test and got "${url}". Refusing to run.`)
  }

  // Prisma 7 has no built-in engine: the connection comes from a driver
  // adapter, exactly as `packages/db/src/client.ts` builds one.
  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  return client
}

/** Named so a failing assertion points at a row somebody can go and look at. */
export const CATALOG = {
  brand: { name: 'Testfoot', slug: 'testfoot' },
  category: { name: 'Running', slug: 'running' },
  /**
   * A size, because a variant without one is not purchasable in the UI.
   *
   * The product page refuses to add to the cart until every option has been
   * chosen — so a seeded variant carrying no options leaves the button reading
   * "Select a size" forever. That is the storefront behaving correctly and the
   * seed being unrealistic, which is exactly the sort of thing only a browser
   * test notices.
   */
  size: {
    name: 'Size',
    slug: 'size',
    /**
     * Two values, not one, and that is deliberate.
     *
     * With a single value the picker auto-selects it and the product is
     * immediately addable — so the "Select a size" state never renders and a
     * spec written against it tests nothing. Two values make the choice real,
     * which is also what every product in the actual catalogue looks like.
     */
    values: ['UK 8', 'UK 9'] as const,
  },
  products: [
    { title: 'Velocity Runner', slug: 'velocity-runner', price: '4999.00', quantity: 25 },
    { title: 'Trail Blazer', slug: 'trail-blazer', price: '7499.00', quantity: 12 },
    { title: 'Court Classic', slug: 'court-classic', price: '3299.00', quantity: 8 },
    // Deliberately out of stock: the PDP has to say so rather than offer it.
    { title: 'Sold Out Sprinter', slug: 'sold-out-sprinter', price: '5999.00', quantity: 0 },
  ],
} as const

export async function seed(): Promise<void> {
  const prisma = connect()
  // Wipe first: a seed that appends leaves the previous run's rows behind, and
  // "there are 4 products" quietly becomes "there are 8".
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      inventory_transactions, inventories, variant_option_assignments,
      product_variant_options, variant_option_values, variant_options,
      product_variants, products, categories, brands, store_settings
    RESTART IDENTITY CASCADE
  `)

  const brand = await prisma.brand.create({ data: { ...CATALOG.brand, status: 'ACTIVE' } })
  const category = await prisma.category.create({
    data: { ...CATALOG.category, status: 'ACTIVE', level: 0 },
  })

  const sizeOption = await prisma.variantOption.create({
    data: { name: CATALOG.size.name, slug: CATALOG.size.slug, position: 0 },
  })
  const sizeValues = []
  for (const [position, value] of CATALOG.size.values.entries()) {
    sizeValues.push(
      await prisma.variantOptionValue.create({
        data: {
          variantOptionId: sizeOption.id,
          value,
          slug: value.toLowerCase().replace(/\s+/g, '-'),
          position,
        },
      }),
    )
  }

  for (const [index, entry] of CATALOG.products.entries()) {
    const product = await prisma.product.create({
      data: {
        title: entry.title,
        slug: entry.slug,
        description: `${entry.title} — a shoe that exists so a test can click it.`,
        status: 'ACTIVE',
        publishedAt: new Date(),
        brandId: brand.id,
        categoryId: category.id,
      },
    })

    await prisma.productVariantOption.create({
      data: { productId: product.id, variantOptionId: sizeOption.id, position: 0 },
    })

    // One variant per size, so the picker has a real choice to make.
    for (const [sizeIndex, sizeValue] of sizeValues.entries()) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `${entry.slug}-${sizeValue.slug}`,
          price: entry.price,
          status: 'ACTIVE',
          position: index * 10 + sizeIndex,
        },
      })

      await prisma.variantOptionAssignment.create({
        data: { variantId: variant.id, optionValueId: sizeValue.id },
      })

      await prisma.inventory.create({
        data: { variantId: variant.id, quantity: entry.quantity, lowStockThreshold: 5 },
      })
    }
  }

  // The shipping quote reads this; without it a checkout page renders no total.
  await prisma.storeSettings.create({
    data: { shippingFlatRate: '99.00', freeShippingThreshold: '1999.00' },
  })
}

export async function disconnect(): Promise<void> {
  await client?.$disconnect()
}

// Runnable directly, which is what the Playwright global setup does.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await seed()
  await disconnect()
  // eslint-disable-next-line no-console
  console.log(`seeded ${CATALOG.products.length} products into shoe_test`)
}
