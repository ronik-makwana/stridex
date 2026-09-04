import { Prisma } from '@shoe/db'
import { describe, expect, it } from 'vitest'
import { discountPercent, money, moneyOrNull } from '../../src/serializers/shop/money.js'
import {
  availableQuantity,
  isPurchasable,
  MAX_QUANTITY_PER_ITEM,
  purchasableQuantity,
  stockBucket,
} from '../../src/serializers/shop/stock.serializer.js'

/**
 * Two rules a customer-facing serializer must never break: they are told
 * whether they can buy and never how many exist, and money leaves as a
 * fixed-point string rather than a float that has already lost a paisa.
 */

const decimal = (value: string | number) => new Prisma.Decimal(value)

const inventory = (quantity: number, reservedQuantity = 0, lowStockThreshold = 0) => ({
  quantity,
  reservedQuantity,
  lowStockThreshold,
})

describe('availableQuantity', () => {
  it('is what is left after open checkouts have reserved theirs', () => {
    expect(availableQuantity(inventory(10, 3))).toBe(7)
  })

  /** An over-reservation bug must read as sold out, never as negative stock. */
  it('clamps at zero when reservations exceed stock', () => {
    expect(availableQuantity(inventory(2, 5))).toBe(0)
  })

  it('treats a missing inventory row as nothing available', () => {
    expect(availableQuantity(null)).toBe(0)
    expect(availableQuantity(undefined)).toBe(0)
  })
})

describe('stockBucket', () => {
  it('is SOLD_OUT with nothing available', () => {
    expect(stockBucket(inventory(0))).toBe('SOLD_OUT')
    expect(stockBucket(inventory(5, 5))).toBe('SOLD_OUT')
  })

  /** A variant with no inventory row is a data problem; the answer is still no. */
  it('is SOLD_OUT for a missing row rather than throwing', () => {
    expect(stockBucket(null)).toBe('SOLD_OUT')
    expect(stockBucket(undefined)).toBe('SOLD_OUT')
  })

  it('is LOW_STOCK at or below the operator’s own threshold', () => {
    expect(stockBucket(inventory(3, 0, 5))).toBe('LOW_STOCK')
    expect(stockBucket(inventory(5, 0, 5))).toBe('LOW_STOCK')
  })

  it('is IN_STOCK above the threshold', () => {
    expect(stockBucket(inventory(6, 0, 5))).toBe('IN_STOCK')
  })

  it('never reports LOW_STOCK when the threshold is zero', () => {
    expect(stockBucket(inventory(1, 0, 0))).toBe('IN_STOCK')
  })

  it('counts reservations when picking the bucket', () => {
    expect(stockBucket(inventory(10, 7, 5))).toBe('LOW_STOCK')
  })
})

describe('purchasableQuantity', () => {
  it('offers what is available when that is under the cap', () => {
    expect(purchasableQuantity(inventory(4))).toBe(4)
  })

  /** The deliberate exception to "never send a number", and why it is bounded. */
  it('never reveals more than the per-item cap, however deep the stock', () => {
    expect(purchasableQuantity(inventory(9999))).toBe(MAX_QUANTITY_PER_ITEM)
    expect(MAX_QUANTITY_PER_ITEM).toBe(10)
  })

  it('is zero when nothing can be bought', () => {
    expect(purchasableQuantity(inventory(0))).toBe(0)
    expect(purchasableQuantity(null)).toBe(0)
  })
})

describe('isPurchasable', () => {
  it('is true for anything still in stock', () => {
    expect(isPurchasable('IN_STOCK')).toBe(true)
    expect(isPurchasable('LOW_STOCK')).toBe(true)
  })

  it('is false only when sold out', () => {
    expect(isPurchasable('SOLD_OUT')).toBe(false)
  })
})

describe('money', () => {
  /** A float would render 8999.95 as something that is not 8999.95. */
  it('always carries two decimal places', () => {
    expect(money(decimal('8999.95'))).toBe('8999.95')
    expect(money(decimal('100'))).toBe('100.00')
    expect(money(decimal('0'))).toBe('0.00')
  })

  it('is a string, never a number', () => {
    expect(typeof money(decimal('1'))).toBe('string')
  })

  it('passes null through untouched', () => {
    expect(moneyOrNull(null)).toBeNull()
    expect(moneyOrNull(decimal('49.5'))).toBe('49.50')
  })
})

describe('discountPercent', () => {
  it('reports a markdown when compare-at is above the price', () => {
    expect(discountPercent(decimal('500'), decimal('1000'))).toBe(50)
  })

  /**
   * Rounded down. Claiming 50% off a 49.6% markdown is the kind of small lie
   * that becomes a consumer-protection complaint.
   */
  it('rounds down rather than flattering the markdown', () => {
    expect(discountPercent(decimal('504'), decimal('1000'))).toBe(49)
  })

  it('is null when there is no markdown to show', () => {
    expect(discountPercent(decimal('1000'), decimal('1000'))).toBeNull()
    expect(discountPercent(decimal('1000'), decimal('900'))).toBeNull()
    expect(discountPercent(decimal('1000'), null)).toBeNull()
  })

  /** Better nothing than "-0% off" beside a struck-through price. */
  it('is null rather than zero for a markdown too small to round to a percent', () => {
    expect(discountPercent(decimal('999.99'), decimal('1000'))).toBeNull()
  })
})
