import { Prisma } from '@shoe/db'
import { describe, expect, it } from 'vitest'
import {
  allGoodsRefunded,
  isWithinReturnWindow,
  lineNet,
  lineRefundAmount,
  quoteRefund,
  refundCeiling,
  refundedSoFar,
  returnableUnits,
  returnWindowEndsAt,
  shippingPaid,
  type CountedRefund,
  type RefundableLine,
  type RefundableOrder,
} from '../../src/modules/refunds/refund.math.js'

/**
 * The file where a wrong answer costs money, so these assert the *properties*
 * the comments in `refund.math.ts` promise — partials that sum exactly, a
 * ceiling that holds before the provider answers — rather than re-stating the
 * arithmetic it already performs.
 */

const decimal = (value: string | number) => new Prisma.Decimal(value)

function line(overrides: Partial<RefundableLine> = {}): RefundableLine {
  return {
    id: 'line-1',
    quantity: 1,
    totalPrice: decimal('100.00'),
    discountAmount: decimal('0'),
    orderDiscountAllocated: decimal('0'),
    ...overrides,
  }
}

function order(overrides: Partial<RefundableOrder> = {}): RefundableOrder {
  return {
    totalAmount: decimal('100.00'),
    shippingAmount: decimal('0'),
    shippingDiscount: decimal('0'),
    ...overrides,
  }
}

function refund(overrides: Partial<CountedRefund> = {}): CountedRefund {
  return { status: 'SUCCEEDED', amount: decimal('0'), items: [], ...overrides }
}

describe('lineNet', () => {
  it('subtracts the line discount and the allocated share of the order discount', () => {
    const net = lineNet(
      line({
        totalPrice: decimal('1000.00'),
        discountAmount: decimal('100.00'),
        orderDiscountAllocated: decimal('50.00'),
      }),
    )
    expect(net.toFixed(2)).toBe('850.00')
  })

  it('floors at zero rather than returning a negative line', () => {
    const net = lineNet(
      line({
        totalPrice: decimal('100.00'),
        discountAmount: decimal('80.00'),
        orderDiscountAllocated: decimal('40.00'),
      }),
    )
    expect(net.toFixed(2)).toBe('0.00')
  })

  it('rounds down, never up', () => {
    const net = lineNet(line({ totalPrice: decimal('10.999'), discountAmount: decimal('0') }))
    expect(net.toFixed(2)).toBe('10.99')
  })
})

describe('lineRefundAmount', () => {
  /**
   * The property the whole cumulative design exists for. Per-unit rounding
   * would give 33.33 three times and quietly keep a paisa of the customer's
   * money.
   */
  it('sums to the line exactly when a line goes back one unit at a time', () => {
    const item = line({ id: 'thirds', quantity: 3, totalPrice: decimal('100.00') })

    const first = lineRefundAmount(item, 0, 1)
    const second = lineRefundAmount(item, 1, 1)
    const third = lineRefundAmount(item, 2, 1)

    expect(first.toFixed(2)).toBe('33.33')
    expect(second.toFixed(2)).toBe('33.33')
    // The last unit collects the remainder.
    expect(third.toFixed(2)).toBe('33.34')
    expect(first.plus(second).plus(third).toFixed(2)).toBe(lineNet(item).toFixed(2))
  })

  it('sums to the line exactly across uneven partials', () => {
    const item = line({ id: 'sevenths', quantity: 7, totalPrice: decimal('99.99') })

    const partials = [
      lineRefundAmount(item, 0, 3),
      lineRefundAmount(item, 3, 1),
      lineRefundAmount(item, 4, 3),
    ]
    const total = partials.reduce((sum, amount) => sum.plus(amount), decimal('0'))

    expect(total.toFixed(2)).toBe(lineNet(item).toFixed(2))
  })

  it('returns the whole line when every unit goes back at once', () => {
    const item = line({ quantity: 3, totalPrice: decimal('100.00') })
    expect(lineRefundAmount(item, 0, 3).toFixed(2)).toBe('100.00')
  })

  it('clamps a request for more units than the line has', () => {
    const item = line({ quantity: 2, totalPrice: decimal('50.00') })
    expect(lineRefundAmount(item, 0, 99).toFixed(2)).toBe('50.00')
  })

  it('is zero once the line is exhausted, rather than throwing', () => {
    const item = line({ quantity: 2, totalPrice: decimal('50.00') })
    expect(lineRefundAmount(item, 2, 1).toFixed(2)).toBe('0.00')
  })

  it('is zero for a line discounted to nothing', () => {
    const item = line({ quantity: 2, totalPrice: decimal('50.00'), discountAmount: decimal('50.00') })
    expect(lineRefundAmount(item, 0, 2).toFixed(2)).toBe('0.00')
  })

  it('treats a negative or zero unit count as nothing to refund', () => {
    const item = line({ quantity: 3, totalPrice: decimal('90.00') })
    expect(lineRefundAmount(item, 0, 0).toFixed(2)).toBe('0.00')
    expect(lineRefundAmount(item, 0, -2).toFixed(2)).toBe('0.00')
  })
})

describe('shippingPaid', () => {
  it('is the rate less whatever a shipping code took off it', () => {
    const paid = shippingPaid(
      order({ shippingAmount: decimal('99.00'), shippingDiscount: decimal('40.00') }),
    )
    expect(paid.toFixed(2)).toBe('59.00')
  })

  it('is zero when delivery was fully waived', () => {
    const paid = shippingPaid(
      order({ shippingAmount: decimal('99.00'), shippingDiscount: decimal('99.00') }),
    )
    expect(paid.toFixed(2)).toBe('0.00')
  })

  it('never goes negative on a discount larger than the rate', () => {
    const paid = shippingPaid(
      order({ shippingAmount: decimal('50.00'), shippingDiscount: decimal('99.00') }),
    )
    expect(paid.toFixed(2)).toBe('0.00')
  })
})

describe('refundedSoFar', () => {
  it('counts money on its way out, so a second refund cannot be promised the same rupees', () => {
    const { amount } = refundedSoFar([
      refund({ status: 'PENDING', amount: decimal('100.00') }),
      refund({ status: 'PROCESSING', amount: decimal('50.00') }),
      refund({ status: 'SUCCEEDED', amount: decimal('25.00') }),
    ])
    expect(amount.toFixed(2)).toBe('175.00')
  })

  it('ignores failed refunds, whose money never left', () => {
    const { amount, unitsByLine } = refundedSoFar([
      refund({ status: 'FAILED', amount: decimal('100.00'), items: [{ orderItemId: 'a', quantity: 2 }] }),
    ])
    expect(amount.toFixed(2)).toBe('0.00')
    expect(unitsByLine.get('a')).toBeUndefined()
  })

  it('adds up units per line across several refunds', () => {
    const { unitsByLine } = refundedSoFar([
      refund({ items: [{ orderItemId: 'a', quantity: 1 }, { orderItemId: 'b', quantity: 3 }] }),
      refund({ status: 'PENDING', items: [{ orderItemId: 'a', quantity: 2 }] }),
    ])
    expect(unitsByLine.get('a')).toBe(3)
    expect(unitsByLine.get('b')).toBe(3)
  })
})

describe('refundCeiling', () => {
  it('counts against what was charged, so goods plus shipping cannot exceed the total', () => {
    const remaining = refundCeiling(order({ totalAmount: decimal('1099.00') }), [
      refund({ amount: decimal('1000.00') }),
    ])
    expect(remaining.toFixed(2)).toBe('99.00')
  })

  it('is zero, not negative, once the order is fully refunded', () => {
    const remaining = refundCeiling(order({ totalAmount: decimal('100.00') }), [
      refund({ amount: decimal('100.00') }),
    ])
    expect(remaining.toFixed(2)).toBe('0.00')
  })

  /** The double-clicked refund button: the second click has nothing left to spend. */
  it('holds against an in-flight refund that has not settled yet', () => {
    const remaining = refundCeiling(order({ totalAmount: decimal('100.00') }), [
      refund({ status: 'PENDING', amount: decimal('100.00') }),
    ])
    expect(remaining.toFixed(2)).toBe('0.00')
  })
})

describe('returnableUnits', () => {
  it('is what is left after what has already gone back', () => {
    expect(returnableUnits(line({ id: 'a', quantity: 5 }), new Map([['a', 2]]))).toBe(3)
  })

  it('is the whole line when nothing has', () => {
    expect(returnableUnits(line({ id: 'a', quantity: 5 }), new Map())).toBe(5)
  })

  it('never goes negative if the ledger says more went back than was bought', () => {
    expect(returnableUnits(line({ id: 'a', quantity: 2 }), new Map([['a', 9]]))).toBe(0)
  })
})

describe('quoteRefund', () => {
  const lines = [
    line({ id: 'a', quantity: 2, totalPrice: decimal('200.00') }),
    line({ id: 'b', quantity: 1, totalPrice: decimal('150.00') }),
  ]

  it('prices the selected lines and totals them', () => {
    const quote = quoteRefund(order(), lines, [
      { orderItemId: 'a', quantity: 1 },
      { orderItemId: 'b', quantity: 1 },
    ])

    expect(quote.items).toHaveLength(2)
    expect(quote.goodsTotal.toFixed(2)).toBe('250.00')
    expect(quote.shipping.toFixed(2)).toBe('0.00')
    expect(quote.total.toFixed(2)).toBe('250.00')
  })

  it('adds the delivery charge back on a cancellation, where the parcel never went', () => {
    const quote = quoteRefund(
      order({ shippingAmount: decimal('99.00'), shippingDiscount: decimal('0') }),
      lines,
      [{ orderItemId: 'b', quantity: 1 }],
      { includeShipping: true },
    )

    expect(quote.goodsTotal.toFixed(2)).toBe('150.00')
    expect(quote.shipping.toFixed(2)).toBe('99.00')
    expect(quote.total.toFixed(2)).toBe('249.00')
  })

  it('leaves the delivery charge on a return, where the courier was paid', () => {
    const quote = quoteRefund(
      order({ shippingAmount: decimal('99.00') }),
      lines,
      [{ orderItemId: 'b', quantity: 1 }],
    )
    expect(quote.shipping.toFixed(2)).toBe('0.00')
  })

  it('ignores a selection naming a line that is not on the order', () => {
    const quote = quoteRefund(order(), lines, [{ orderItemId: 'not-on-this-order', quantity: 1 }])
    expect(quote.items).toHaveLength(0)
    expect(quote.total.toFixed(2)).toBe('0.00')
  })

  it('clamps to what is left rather than inventing money', () => {
    const quote = quoteRefund(order(), lines, [{ orderItemId: 'a', quantity: 99 }], {
      alreadyRefunded: [refund({ items: [{ orderItemId: 'a', quantity: 1 }] })],
    })

    expect(quote.items).toEqual([
      expect.objectContaining({ orderItemId: 'a', quantity: 1 }),
    ])
    expect(quote.goodsTotal.toFixed(2)).toBe('100.00')
  })

  it('drops a line that has already gone back in full', () => {
    const quote = quoteRefund(order(), lines, [{ orderItemId: 'b', quantity: 1 }], {
      alreadyRefunded: [refund({ items: [{ orderItemId: 'b', quantity: 1 }] })],
    })
    expect(quote.items).toHaveLength(0)
  })

  /** Two partials against the same line must still add up to the line. */
  it('never pays out more than the line across successive quotes', () => {
    const item = line({ id: 'c', quantity: 3, totalPrice: decimal('100.00') })

    const first = quoteRefund(order(), [item], [{ orderItemId: 'c', quantity: 1 }])
    const second = quoteRefund(order(), [item], [{ orderItemId: 'c', quantity: 2 }], {
      alreadyRefunded: [refund({ amount: first.total, items: [{ orderItemId: 'c', quantity: 1 }] })],
    })

    expect(first.total.plus(second.total).toFixed(2)).toBe('100.00')
  })
})

describe('allGoodsRefunded', () => {
  const lines = [line({ id: 'a', quantity: 2 }), line({ id: 'b', quantity: 1 })]

  it('is true once every unit has come home', () => {
    expect(
      allGoodsRefunded(lines, [
        refund({ items: [{ orderItemId: 'a', quantity: 2 }, { orderItemId: 'b', quantity: 1 }] }),
      ]),
    ).toBe(true)
  })

  it('is false while a single unit is outstanding', () => {
    expect(
      allGoodsRefunded(lines, [
        refund({ items: [{ orderItemId: 'a', quantity: 2 }] }),
      ]),
    ).toBe(false)
  })

  /** Counted in units, not money: a line discounted to zero still came back. */
  it('is true for a line worth nothing back, once its units have returned', () => {
    const free = [line({ id: 'z', quantity: 1, totalPrice: decimal('0'), discountAmount: decimal('0') })]
    expect(allGoodsRefunded(free, [refund({ amount: decimal('0'), items: [{ orderItemId: 'z', quantity: 1 }] })])).toBe(
      true,
    )
  })

  it('does not count a failed refund as goods returned', () => {
    expect(
      allGoodsRefunded(lines, [
        refund({
          status: 'FAILED',
          items: [{ orderItemId: 'a', quantity: 2 }, { orderItemId: 'b', quantity: 1 }],
        }),
      ]),
    ).toBe(false)
  })
})

describe('the return window', () => {
  const delivered = new Date('2026-09-01T10:00:00.000Z')

  it('is null when nothing has been delivered — not the same as closed', () => {
    expect(returnWindowEndsAt(null, 7)).toBeNull()
    expect(isWithinReturnWindow(null, 7, delivered)).toBe(false)
  })

  it('ends the configured number of days after delivery', () => {
    expect(returnWindowEndsAt(delivered, 7)?.toISOString()).toBe('2026-09-08T10:00:00.000Z')
  })

  it('is open up to and including the final moment', () => {
    expect(isWithinReturnWindow(delivered, 7, new Date('2026-09-08T10:00:00.000Z'))).toBe(true)
    expect(isWithinReturnWindow(delivered, 7, new Date('2026-09-08T10:00:00.001Z'))).toBe(false)
  })

  /** Recomputed from `delivered_at`, so extending the setting extends live orders. */
  it('reopens for orders already out there when the store lengthens the window', () => {
    const now = new Date('2026-09-10T10:00:00.000Z')
    expect(isWithinReturnWindow(delivered, 7, now)).toBe(false)
    expect(isWithinReturnWindow(delivered, 14, now)).toBe(true)
  })
})
