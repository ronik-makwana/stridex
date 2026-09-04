import { Prisma } from '@shoe/db'
import { describe, expect, it } from 'vitest'
import { allocate } from '../../src/modules/checkout/discount.engine.js'

/**
 * `allocate` is the half of the discount engine that needs no transaction: the
 * coupons have already been costed, and this decides which one wins each line.
 *
 * The two rules it has to keep are both about trust rather than arithmetic — a
 * line is never discounted twice, and the customer is never quietly handed the
 * worse of two codes they hold.
 */

const decimal = (value: string | number) => new Prisma.Decimal(value)

const candidate = (couponId: string, lines: Record<string, string>) => ({
  couponId,
  perLine: new Map(Object.entries(lines).map(([id, amount]) => [id, decimal(amount)])),
})

describe('allocate', () => {
  it('awards each line to whichever coupon takes the most off that line', () => {
    const { perLine } = allocate([
      candidate('ten-percent', { 'line-a': '100.00', 'line-b': '20.00' }),
      candidate('flat-fifty', { 'line-a': '50.00', 'line-b': '50.00' }),
    ])

    expect(perLine.get('line-a')?.couponId).toBe('ten-percent')
    expect(perLine.get('line-a')?.amount.toFixed(2)).toBe('100.00')
    expect(perLine.get('line-b')?.couponId).toBe('flat-fifty')
    expect(perLine.get('line-b')?.amount.toFixed(2)).toBe('50.00')
  })

  it('never discounts a line twice', () => {
    const { perLine } = allocate([
      candidate('first', { 'line-a': '30.00' }),
      candidate('second', { 'line-a': '40.00' }),
      candidate('third', { 'line-a': '35.00' }),
    ])

    expect(perLine.size).toBe(1)
    expect(perLine.get('line-a')?.amount.toFixed(2)).toBe('40.00')
  })

  /**
   * The order the customer applied them is the only order they can see. Any
   * other tie-break resolves by something they cannot reason about.
   */
  it('breaks a tie in favour of the coupon applied first', () => {
    const { perLine } = allocate([
      candidate('applied-first', { 'line-a': '50.00' }),
      candidate('applied-second', { 'line-a': '50.00' }),
    ])

    expect(perLine.get('line-a')?.couponId).toBe('applied-first')
  })

  it('totals per coupon from the lines it actually won', () => {
    const { perCoupon } = allocate([
      candidate('winner', { 'line-a': '100.00', 'line-b': '10.00' }),
      candidate('runner-up', { 'line-a': '90.00', 'line-b': '80.00' }),
    ])

    expect(perCoupon.get('winner')?.toFixed(2)).toBe('100.00')
    expect(perCoupon.get('runner-up')?.toFixed(2)).toBe('80.00')
  })

  /**
   * A real outcome, not an error: another code covered the same items for more.
   * It stays applied and worth zero so the customer can see which to remove.
   */
  it('reports a coupon that won nothing as zero rather than dropping it', () => {
    const { perCoupon } = allocate([
      candidate('generous', { 'line-a': '100.00' }),
      candidate('beaten', { 'line-a': '10.00' }),
    ])

    expect(perCoupon.has('beaten')).toBe(true)
    expect(perCoupon.get('beaten')?.toFixed(2)).toBe('0.00')
  })

  it('lets coupons covering different lines both win', () => {
    const { perLine, perCoupon } = allocate([
      candidate('shoes', { 'line-a': '40.00' }),
      candidate('socks', { 'line-b': '15.00' }),
    ])

    expect(perLine.get('line-a')?.couponId).toBe('shoes')
    expect(perLine.get('line-b')?.couponId).toBe('socks')
    expect(perCoupon.get('shoes')?.toFixed(2)).toBe('40.00')
    expect(perCoupon.get('socks')?.toFixed(2)).toBe('15.00')
  })

  it('handles a cart with no coupons on it', () => {
    const { perLine, perCoupon } = allocate([])
    expect(perLine.size).toBe(0)
    expect(perCoupon.size).toBe(0)
  })

  it('handles a coupon that matched no lines at all', () => {
    const { perLine, perCoupon } = allocate([candidate('matched-nothing', {})])
    expect(perLine.size).toBe(0)
    expect(perCoupon.get('matched-nothing')?.toFixed(2)).toBe('0.00')
  })
})
