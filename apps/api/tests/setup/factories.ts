import { prisma } from '@shoe/db'

/**
 * Row builders for the integration tests.
 *
 * Every one takes overrides and fills the rest with something valid, so a test
 * about stock locking names a quantity and nothing else. The point is not
 * brevity: it is that a test's body should contain only the facts the test is
 * about, and a reader should be able to tell which of the values on screen
 * matter.
 *
 * Unique columns get a counter rather than a random string, so a failure names
 * `sku-3` and not a uuid nobody can search the output for.
 */

let sequence = 0
const next = () => (sequence += 1)

/** Reset between files so ids stay small and readable. Rows are gone by then. */
export function resetFactorySequence(): void {
  sequence = 0
}

export async function createBrand(overrides: { name?: string; slug?: string } = {}) {
  const n = next()
  return prisma.brand.create({
    data: { name: overrides.name ?? `Brand ${n}`, slug: overrides.slug ?? `brand-${n}` },
  })
}

export async function createCategory(
  overrides: { name?: string; slug?: string; parentId?: string; level?: number } = {},
) {
  const n = next()
  return prisma.category.create({
    data: {
      name: overrides.name ?? `Category ${n}`,
      slug: overrides.slug ?? `category-${n}`,
      parentId: overrides.parentId,
      level: overrides.level ?? 0,
    },
  })
}

export async function createProduct(
  overrides: {
    title?: string
    slug?: string
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
    categoryId?: string
    brandId?: string
  } = {},
) {
  const n = next()
  return prisma.product.create({
    data: {
      title: overrides.title ?? `Product ${n}`,
      slug: overrides.slug ?? `product-${n}`,
      // ACTIVE by default: a DRAFT product is invisible to every storefront
      // query, which makes an otherwise correct test fail for a reason that has
      // nothing to do with what it is checking.
      status: overrides.status ?? 'ACTIVE',
      publishedAt: new Date(),
      categoryId: overrides.categoryId,
      brandId: overrides.brandId,
    },
  })
}

/**
 * A variant with its inventory row, because a variant without one is a data
 * problem rather than a state worth setting up on purpose. Pass
 * `quantity: null` for the deliberately-missing-row case.
 */
export async function createVariant(
  productId: string,
  overrides: {
    sku?: string
    price?: string
    compareAtPrice?: string
    quantity?: number | null
    reservedQuantity?: number
    lowStockThreshold?: number
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  } = {},
) {
  const n = next()
  const variant = await prisma.productVariant.create({
    data: {
      productId,
      sku: overrides.sku ?? `sku-${n}`,
      price: overrides.price ?? '1000.00',
      compareAtPrice: overrides.compareAtPrice,
      status: overrides.status ?? 'ACTIVE',
    },
  })

  if (overrides.quantity !== null) {
    await prisma.inventory.create({
      data: {
        variantId: variant.id,
        quantity: overrides.quantity ?? 10,
        reservedQuantity: overrides.reservedQuantity ?? 0,
        lowStockThreshold: overrides.lowStockThreshold ?? 5,
      },
    })
  }

  return variant
}

/** A product with one variant, which is what most tests actually want. */
export async function createSellableProduct(
  overrides: { quantity?: number; price?: string; title?: string } = {},
) {
  const product = await createProduct({ title: overrides.title })
  const variant = await createVariant(product.id, {
    quantity: overrides.quantity,
    price: overrides.price,
  })
  return { product, variant }
}

export async function createUser(
  overrides: {
    email?: string
    role?: 'ADMIN' | 'STAFF' | 'CUSTOMER'
    status?: 'ACTIVE' | 'SUSPENDED'
  } = {},
) {
  const n = next()
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${n}@example.test`,
      // Not a real argon2 hash: hashing a password is ~100ms and no integration
      // test here signs in by password. The ones that need a session mint a
      // token directly.
      passwordHash: 'not-a-real-hash',
      role: overrides.role ?? 'CUSTOMER',
      status: overrides.status ?? 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  })
}

export async function createAddress(userId: string, overrides: { fullName?: string } = {}) {
  return prisma.address.create({
    data: {
      userId,
      fullName: overrides.fullName ?? 'Test Customer',
      phone: '9999999999',
      addressLine1: '1 Test Street',
      city: 'Mumbai',
      state: 'MH',
      postalCode: '400001',
    },
  })
}

/**
 * A checkout session as it exists at the moment payment is started: items
 * priced, stock held, an address on it, and a PENDING payment row carrying the
 * provider's order id.
 *
 * This is the state the webhook arrives into, so it is the state the webhook
 * tests have to be able to produce. Building it from the real tables rather
 * than from a fixture file means a schema change breaks the factory, which is
 * where it should break.
 */
export async function createPaidCheckout(
  overrides: { quantity?: number; unitPrice?: string; shippingAmount?: string } = {},
) {
  const quantity = overrides.quantity ?? 2
  const unitPrice = overrides.unitPrice ?? '1000.00'
  const shippingAmount = overrides.shippingAmount ?? '99.00'

  const user = await createUser()
  const address = await createAddress(user.id)
  const { product, variant } = await createSellableProduct({ quantity: 10, price: unitPrice })

  const subtotal = (Number(unitPrice) * quantity).toFixed(2)
  const total = (Number(subtotal) + Number(shippingAmount)).toFixed(2)
  const expiresAt = new Date(Date.now() + 10 * 60_000)

  const session = await prisma.checkoutSession.create({
    data: {
      userId: user.id,
      status: 'ACTIVE',
      expiresAt,
      subtotal,
      shippingAmount,
      totalAmount: total,
      shippingAddressId: address.id,
      billingAddressId: address.id,
      items: {
        create: [
          {
            variantId: variant.id,
            productTitle: product.title,
            sku: variant.sku,
            unitPrice,
            quantity,
            totalPrice: subtotal,
          },
        ],
      },
      reservations: {
        create: [{ variantId: variant.id, quantity, status: 'ACTIVE', expiresAt }],
      },
    },
    include: { items: true, reservations: true },
  })

  // Stock is held while the session is open, exactly as `checkout.create` leaves it.
  await prisma.inventory.update({
    where: { variantId: variant.id },
    data: { reservedQuantity: quantity },
  })

  const n = next()
  const payment = await prisma.payment.create({
    data: {
      checkoutSessionId: session.id,
      provider: 'razorpay',
      // An `order_…`, not a `pay_…`: see the note at the top of the Razorpay
      // provider. This is what the webhook looks the payment up by.
      providerPaymentId: `order_test_${n}`,
      amount: total,
      status: 'PENDING',
      idempotencyKey: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
    },
  })

  return { user, address, product, variant, session, payment, quantity, total }
}

/** The settings row the shipping quote reads. Singleton in practice. */
export async function createStoreSettings(
  overrides: { shippingFlatRate?: string; freeShippingThreshold?: string | null } = {},
) {
  const existing = await prisma.storeSettings.findFirst()
  if (existing) return existing

  return prisma.storeSettings.create({
    data: {
      shippingFlatRate: overrides.shippingFlatRate ?? '99.00',
      freeShippingThreshold:
        overrides.freeShippingThreshold === null
          ? null
          : (overrides.freeShippingThreshold ?? '1999.00'),
    },
  })
}
