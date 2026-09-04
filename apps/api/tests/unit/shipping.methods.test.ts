import { Prisma } from '@shoe/db'
import { describe, expect, it } from 'vitest'
import {
  labelFor,
  quoteMethods,
  rateFor,
  SHIPPING_METHODS,
} from '../../src/modules/checkout/shipping.methods.js'

/**
 * The rule under test is a commercial one, not an arithmetic one: "free
 * delivery over ₹1,999" is a promise about the slow van. A threshold that
 * waived next-day delivery too is how a shipping bill outgrows its margin.
 */

const decimal = (value: string | number) => new Prisma.Decimal(value)

const settings = (flatRate: string, threshold: string | null) => ({
  shippingFlatRate: decimal(flatRate),
  freeShippingThreshold: threshold === null ? null : decimal(threshold),
})

const store = settings('99.00', '1999.00')

describe('standard delivery', () => {
  it('charges the store flat rate below the threshold', () => {
    expect(rateFor('STANDARD', decimal('1998.99'), store).toFixed(2)).toBe('99.00')
  })

  it('is free exactly at the threshold, not only above it', () => {
    expect(rateFor('STANDARD', decimal('1999.00'), store).toFixed(2)).toBe('0.00')
  })

  it('is free above the threshold', () => {
    expect(rateFor('STANDARD', decimal('5000.00'), store).toFixed(2)).toBe('0.00')
  })

  it('always charges the flat rate when the store has no threshold configured', () => {
    expect(rateFor('STANDARD', decimal('99999.00'), settings('99.00', null)).toFixed(2)).toBe('99.00')
  })
})

describe('the paid services', () => {
  it('carries its own rate', () => {
    expect(rateFor('EXPRESS', decimal('0'), store).toFixed(2)).toBe('249.00')
    expect(rateFor('PRIORITY', decimal('0'), store).toFixed(2)).toBe('499.00')
  })

  /** The rule the free-delivery promise is not allowed to reach. */
  it('is never waived by the free-delivery threshold', () => {
    expect(rateFor('EXPRESS', decimal('100000.00'), store).toFixed(2)).toBe('249.00')
    expect(rateFor('PRIORITY', decimal('100000.00'), store).toFixed(2)).toBe('499.00')
  })

  it('ignores the store flat rate entirely', () => {
    expect(rateFor('EXPRESS', decimal('0'), settings('999.00', null)).toFixed(2)).toBe('249.00')
  })
})

describe('rateFor, on input it should never see', () => {
  /**
   * The route validates against this same list, so this is the answer for a row
   * written under a method since retired. Undercharging a courier is worse than
   * quoting the ordinary rate.
   */
  it('prices an unknown code as standard rather than as free', () => {
    expect(rateFor('DRONE', decimal('0'), store).toFixed(2)).toBe('99.00')
  })

  it('lets an unknown code be waived like standard', () => {
    expect(rateFor('DRONE', decimal('2000.00'), store).toFixed(2)).toBe('0.00')
  })

  it('quotes nothing rather than throwing when the settings row is missing', () => {
    expect(rateFor('STANDARD', decimal('0'), null).toFixed(2)).toBe('0.00')
  })

  it('still charges a paid service with no settings row', () => {
    expect(rateFor('EXPRESS', decimal('0'), null).toFixed(2)).toBe('249.00')
  })
})

describe('quoteMethods', () => {
  it('prices every method for this order, so the client adds nothing of its own', () => {
    const quoted = quoteMethods(decimal('2000.00'), store)

    expect(quoted).toHaveLength(SHIPPING_METHODS.length)
    expect(quoted.map((method) => [method.code, method.amount.toFixed(2)])).toEqual([
      ['STANDARD', '0.00'],
      ['EXPRESS', '249.00'],
      ['PRIORITY', '499.00'],
    ])
  })

  it('carries the label and eta the checkout page renders', () => {
    const [standard] = quoteMethods(decimal('0'), store)
    expect(standard).toMatchObject({ code: 'STANDARD', label: 'Standard', eta: '4–6 business days' })
  })

  it('agrees with rateFor for every method', () => {
    const goodsTotal = decimal('2500.00')
    for (const method of quoteMethods(goodsTotal, store)) {
      expect(method.amount.toFixed(2)).toBe(rateFor(method.code, goodsTotal, store).toFixed(2))
    }
  })
})

describe('labelFor', () => {
  it('names a known method', () => {
    expect(labelFor('PRIORITY')).toBe('Priority')
  })

  /** An order placed under a method since retired still has to render. */
  it('falls back to the stored code for one it no longer offers', () => {
    expect(labelFor('DRONE')).toBe('DRONE')
  })
})
