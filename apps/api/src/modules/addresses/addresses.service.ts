import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound, unprocessable } from '../../lib/errors.js'
import type {
  CreateAddressInput,
  UpdateAddressInput,
} from '../../schemas/shop/address.schema.js'

/**
 * The address book. Every function here takes the owner as its first argument
 * and scopes on it inside the `where`, rather than reading a row and checking
 * afterwards — the difference matters, because the second shape leaks existence
 * through timing and through the 403 it wants to return (§22).
 *
 * Someone else's address id is a 404. Not a 403: telling an attacker that an id
 * is real but not theirs is the whole of the information they were after.
 */

/**
 * A ceiling, not a business rule. Nobody has thirty delivery addresses; an
 * unbounded list is a table one script can fill.
 */
const MAX_ADDRESSES = 20

/** Default first, then newest — the order the checkout picker wants to render. */
const listOrder = [
  { isDefault: 'desc' },
  { createdAt: 'desc' },
] satisfies Prisma.AddressOrderByWithRelationInput[]

export async function findMany(userId: string) {
  return prisma.address.findMany({ where: { userId }, orderBy: listOrder })
}

/** Exists-and-is-yours, or 404. Every write starts here. */
async function ownedOrThrow(userId: string, id: string) {
  const address = await prisma.address.findFirst({ where: { id, userId } })
  if (!address) throw notFound('Address')
  return address
}

export async function findById(userId: string, id: string) {
  return ownedOrThrow(userId, id)
}

/**
 * Demote whatever is currently default, and do it *before* promoting the new
 * one. The order is not stylistic: `addresses_one_default_per_user_idx` in
 * prisma/sql/003 is a partial unique index over `(user_id) WHERE is_default`,
 * so two default rows cannot coexist even for the length of a transaction —
 * promote-then-demote raises a unique violation the customer would read as
 * "that value is already in use".
 *
 * The index is the real guarantee here; this function only keeps the write
 * legal. `keepId` is the row about to be promoted, or absent when it does not
 * exist yet.
 */
async function clearOtherDefaults(
  tx: Prisma.TransactionClient,
  userId: string,
  keepId?: string,
) {
  await tx.address.updateMany({
    where: { userId, isDefault: true, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { isDefault: false },
  })
}

export async function create(userId: string, input: CreateAddressInput) {
  const count = await prisma.address.count({ where: { userId } })
  if (count >= MAX_ADDRESSES) {
    throw unprocessable(
      `You can save up to ${MAX_ADDRESSES} addresses`,
      'Delete one you no longer use, then try again.',
    )
  }

  // The first one is the default whatever the request said. An address book
  // with no default makes checkout ask a question that has only one answer.
  const isDefault = input.isDefault === true || count === 0

  return prisma.$transaction(async (tx) => {
    // Demote first — see `clearOtherDefaults`.
    if (isDefault) await clearOtherDefaults(tx, userId)

    const address = await tx.address.create({
      data: {
        userId,
        fullName: input.fullName,
        phone: input.phone,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        state: input.state,
        country: input.country,
        postalCode: input.postalCode,
        isDefault,
      },
    })
    return address
  })
}

export async function update(userId: string, id: string, input: UpdateAddressInput) {
  await ownedOrThrow(userId, id)

  const data: Prisma.AddressUpdateInput = {}
  if (input.fullName !== undefined) data.fullName = input.fullName
  if (input.phone !== undefined) data.phone = input.phone
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1
  if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2
  if (input.city !== undefined) data.city = input.city
  if (input.state !== undefined) data.state = input.state
  if (input.country !== undefined) data.country = input.country
  if (input.postalCode !== undefined) data.postalCode = input.postalCode
  if (input.isDefault === true) data.isDefault = true

  return prisma.$transaction(async (tx) => {
    if (input.isDefault === true) await clearOtherDefaults(tx, userId, id)
    return tx.address.update({ where: { id }, data })
  })
}

/**
 * A deleted address leaves its orders alone — `order_addresses` holds its own
 * copy, and an open checkout pointing at it is set null rather than cascaded
 * (see the FKs on `checkout_sessions`). What it must not leave behind is an
 * address book with no default, so the newest survivor is promoted.
 */
export async function remove(userId: string, id: string): Promise<void> {
  const address = await ownedOrThrow(userId, id)

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } })
    if (!address.isDefault) return

    const next = await tx.address.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } })
  })
}

/**
 * Its own route rather than a PATCH body, for the same reason the admin gives
 * status its own: the address card's "Default" link is one click, and it should
 * not have to send a whole address to make it.
 */
export async function setDefault(userId: string, id: string) {
  await ownedOrThrow(userId, id)

  return prisma.$transaction(async (tx) => {
    await clearOtherDefaults(tx, userId, id)
    return tx.address.update({ where: { id }, data: { isDefault: true } })
  })
}
