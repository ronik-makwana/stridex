import type { OrderStatus } from '@shoe/db'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/lib/errors.js'
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  isBackwards,
} from '../../src/modules/orders/order-status.js'

/**
 * The fulfilment state machine. The property worth protecting is that an
 * illegal move *throws* rather than silently doing nothing — a no-op looks like
 * success to whoever clicked it, and the order stays where it was while
 * everybody believes otherwise.
 */

const TERMINAL: OrderStatus[] = ['CANCELLED', 'REFUNDED']

describe('canTransition', () => {
  it.each([
    ['PENDING', 'PROCESSING'],
    ['PENDING', 'CANCELLED'],
    ['PROCESSING', 'SHIPPED'],
    ['PROCESSING', 'CANCELLED'],
    ['SHIPPED', 'DELIVERED'],
    ['DELIVERED', 'REFUNDED'],
  ] as [OrderStatus, OrderStatus][])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each([
    ['PENDING', 'SHIPPED'],
    ['PENDING', 'DELIVERED'],
    ['PROCESSING', 'DELIVERED'],
    ['SHIPPED', 'CANCELLED'],
    ['DELIVERED', 'CANCELLED'],
  ] as [OrderStatus, OrderStatus][])('refuses %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  /** Reviving one hides what happened behind a status the money no longer matches. */
  it.each(TERMINAL)('makes %s terminal', (from) => {
    const everyStatus: OrderStatus[] = [
      'PENDING',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ]
    for (const to of everyStatus) {
      expect(canTransition(from, to)).toBe(false)
    }
    expect(allowedTransitions(from)).toHaveLength(0)
  })
})

describe('corrections', () => {
  /** A parcel marked shipped by mistake has to be fixable outside the database. */
  it.each([
    ['PROCESSING', 'PENDING'],
    ['SHIPPED', 'PROCESSING'],
    ['DELIVERED', 'SHIPPED'],
  ] as [OrderStatus, OrderStatus][])('permits %s → %s and flags it as backwards', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
    expect(isBackwards(from, to)).toBe(true)
  })

  it('allows one step back only', () => {
    expect(canTransition('DELIVERED', 'PROCESSING')).toBe(false)
    expect(canTransition('SHIPPED', 'PENDING')).toBe(false)
  })

  it('does not flag a forward move as a correction', () => {
    expect(isBackwards('PENDING', 'PROCESSING')).toBe(false)
    expect(isBackwards('DELIVERED', 'REFUNDED')).toBe(false)
  })
})

describe('allowedTransitions', () => {
  it('offers the forward moves and the correction together, each labelled', () => {
    expect(allowedTransitions('PROCESSING')).toEqual([
      { to: 'SHIPPED', backwards: false },
      { to: 'CANCELLED', backwards: false },
      { to: 'PENDING', backwards: true },
    ])
  })

  it('agrees with canTransition for every status it offers', () => {
    const everyStatus: OrderStatus[] = [
      'PENDING',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ]
    for (const from of everyStatus) {
      for (const option of allowedTransitions(from)) {
        expect(canTransition(from, option.to)).toBe(true)
        expect(isBackwards(from, option.to)).toBe(option.backwards)
      }
    }
  })
})

describe('assertTransition', () => {
  it('passes a legal move without throwing', () => {
    expect(() => assertTransition('PENDING', 'PROCESSING')).not.toThrow()
  })

  it('throws rather than quietly doing nothing on an illegal move', () => {
    expect(() => assertTransition('PENDING', 'DELIVERED')).toThrow(AppError)
  })

  it('answers 422 with the codes the client branches on', () => {
    try {
      assertTransition('PENDING', 'DELIVERED')
      expect.unreachable('an illegal transition must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).statusCode).toBe(422)
      expect((error as AppError).code).toBe('UNPROCESSABLE')
    }
  })

  it('names where the order could go instead', () => {
    try {
      assertTransition('PENDING', 'DELIVERED')
      expect.unreachable('an illegal transition must throw')
    } catch (error) {
      expect((error as AppError).reason).toBe('From here it can go to: processing, cancelled.')
    }
  })

  it('says so plainly when the order has nowhere left to go', () => {
    try {
      assertTransition('CANCELLED', 'PROCESSING')
      expect.unreachable('a terminal status must throw')
    } catch (error) {
      expect((error as AppError).reason).toBe('cancelled is where this order ends.')
    }
  })

  /** Re-submitting the same status is a distinct message, not "cannot go". */
  it('reports a no-change move as already being there', () => {
    try {
      assertTransition('SHIPPED', 'SHIPPED')
      expect.unreachable('a same-status transition must throw')
    } catch (error) {
      expect((error as AppError).message).toBe('This order is already shipped')
    }
  })
})
