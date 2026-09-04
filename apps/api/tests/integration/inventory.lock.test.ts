import { prisma } from '@shoe/db'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyStockMove } from '../../src/modules/inventory/inventory.service.js'
import { createSellableProduct, createVariant, resetFactorySequence } from '../setup/factories.js'

/**
 * The one thing a unit test genuinely cannot prove.
 *
 * `applyStockMove` is built on `SELECT … FOR UPDATE`, and its correctness is a
 * property of Postgres holding a row lock across two concurrent transactions —
 * not of the code's shape. Mocked, the assertion would be that the mock
 * serialises writes. So these run against a real database, concurrently, and
 * check the invariant that matters: **the ledger always adds up to the row**.
 *
 * That invariant is the whole reason the lock exists. Two writers who both read
 * 20 and both write their own answer leave an inventory row and a transaction
 * log that disagree — and at that moment the ledger stops being evidence and
 * becomes decoration.
 */

beforeEach(() => {
  resetFactorySequence()
})

/** What the ledger says the quantity should be, from its own rows. */
async function ledgerTotal(variantId: string): Promise<number> {
  const rows = await prisma.inventoryTransaction.findMany({
    where: { inventory: { variantId } },
    select: { quantity: true },
  })
  return rows.reduce((sum, row) => sum + row.quantity, 0)
}

async function quantityOf(variantId: string): Promise<number> {
  const row = await prisma.inventory.findUnique({ where: { variantId } })
  return row?.quantity ?? 0
}

const move = (variantId: string, delta: number) =>
  prisma.$transaction((tx) =>
    applyStockMove(tx, {
      variantId,
      delta,
      type: delta > 0 ? 'RESTOCK' : 'ADJUSTMENT',
      referenceType: 'test',
    }),
  )

describe('applyStockMove, one writer at a time', () => {
  it('adds stock and writes a matching ledger row', async () => {
    const { variant } = await createSellableProduct({ quantity: 10 })

    const result = await move(variant.id, 5)

    expect(result.quantity).toBe(15)
    expect(await quantityOf(variant.id)).toBe(15)
    expect(await ledgerTotal(variant.id)).toBe(5)
  })

  it('removes stock', async () => {
    const { variant } = await createSellableProduct({ quantity: 10 })

    await move(variant.id, -4)

    expect(await quantityOf(variant.id)).toBe(6)
    expect(await ledgerTotal(variant.id)).toBe(-4)
  })

  /** A variant with no inventory row must not make stock unwritable. */
  it('creates a missing inventory row rather than failing', async () => {
    const { product } = await createSellableProduct()
    const orphan = await createVariant(product.id, { quantity: null })

    expect(await prisma.inventory.findUnique({ where: { variantId: orphan.id } })).toBeNull()

    const result = await move(orphan.id, 7)

    expect(result.quantity).toBe(7)
    expect(await quantityOf(orphan.id)).toBe(7)
  })

  it('records the reference so a move can be traced back to its cause', async () => {
    const { variant } = await createSellableProduct({ quantity: 10 })
    // `reference_id` is a uuid column, not free text: it points at the order or
    // adjustment that caused the move.
    const orderId = '33333333-3333-4333-8333-333333333333'

    await prisma.$transaction((tx) =>
      applyStockMove(tx, {
        variantId: variant.id,
        delta: -2,
        type: 'SALE',
        referenceType: 'order',
        referenceId: orderId,
        note: 'sold',
      }),
    )

    const entry = await prisma.inventoryTransaction.findFirst({
      where: { inventory: { variantId: variant.id } },
    })
    expect(entry).toMatchObject({
      quantity: -2,
      type: 'SALE',
      referenceType: 'order',
      referenceId: orderId,
    })
  })
})

describe('applyStockMove, under concurrency', () => {
  /**
   * The test the lock exists for. Without `FOR UPDATE` both transactions read
   * the same starting quantity and the second overwrites the first, so the row
   * ends at 9 while the ledger says −2.
   */
  it('does not lose a write when transactions hit the same variant at once', async () => {
    const { variant } = await createSellableProduct({ quantity: 50 })

    /**
     * Twelve rather than two, and that number is load-bearing. Two
     * transactions launched together usually do not actually overlap — the
     * first commits before the second reads — so the pair passes with the lock
     * removed and proves nothing. Twelve reliably contend.
     */
    await Promise.all(Array.from({ length: 12 }, () => move(variant.id, -1)))

    expect(await quantityOf(variant.id)).toBe(38)
    expect(await ledgerTotal(variant.id)).toBe(-12)
  })

  it('keeps the row and the ledger in agreement across many concurrent moves', async () => {
    const { variant } = await createSellableProduct({ quantity: 100 })

    const moves = [
      ...Array.from({ length: 10 }, () => -3),
      ...Array.from({ length: 5 }, () => +4),
    ]
    await Promise.all(moves.map((delta) => move(variant.id, delta)))

    const expected = 100 + moves.reduce((sum, delta) => sum + delta, 0)

    expect(await quantityOf(variant.id)).toBe(expected)
    expect(await ledgerTotal(variant.id)).toBe(expected - 100)
    expect(await prisma.inventoryTransaction.count()).toBe(moves.length)
  })

  /**
   * Two variants have no reason to wait for each other — the lock is per row,
   * and a lock that serialised the table would make a busy catalogue crawl.
   */
  it('does not serialise writes to different variants', async () => {
    const first = await createSellableProduct({ quantity: 10 })
    const second = await createSellableProduct({ quantity: 10 })

    await Promise.all([move(first.variant.id, -1), move(second.variant.id, -1)])

    expect(await quantityOf(first.variant.id)).toBe(9)
    expect(await quantityOf(second.variant.id)).toBe(9)
  })

  /**
   * Concurrent creation of the same missing row: one transaction wins the
   * unique index on `variant_id` and the other must not be left with a stock
   * write that went nowhere.
   */
  it('survives two writers racing to create the same missing inventory row', async () => {
    const { product } = await createSellableProduct()
    const orphan = await createVariant(product.id, { quantity: null })

    const results = await Promise.allSettled([move(orphan.id, 5), move(orphan.id, 5)])
    const settled = results.filter((r) => r.status === 'fulfilled')

    // Whatever the split of winners and losers, the two must agree afterwards.
    expect(settled.length).toBeGreaterThanOrEqual(1)
    expect(await quantityOf(orphan.id)).toBe(await ledgerTotal(orphan.id))
    expect(await prisma.inventory.count({ where: { variantId: orphan.id } })).toBe(1)
  })
})

describe('the transaction boundary', () => {
  /**
   * `applyStockMove` takes a caller-supplied transaction precisely so that a
   * stock move can be rolled back with whatever else the caller was doing —
   * reserving a checkout, confirming an order. If it committed on its own, a
   * failed order would leave stock deducted for a sale that never happened.
   */
  it('rolls the stock move back when the surrounding transaction fails', async () => {
    const { variant } = await createSellableProduct({ quantity: 10 })

    await expect(
      prisma.$transaction(async (tx) => {
        await applyStockMove(tx, {
          variantId: variant.id,
          delta: -5,
          type: 'SALE',
          referenceType: 'test',
        })
        throw new Error('the caller failed after moving stock')
      }),
    ).rejects.toThrow('the caller failed after moving stock')

    expect(await quantityOf(variant.id)).toBe(10)
    expect(await ledgerTotal(variant.id)).toBe(0)
    expect(await prisma.inventoryTransaction.count()).toBe(0)
  })
})
