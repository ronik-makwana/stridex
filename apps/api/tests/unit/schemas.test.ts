import { describe, expect, it } from 'vitest'
import {
  booleanQuerySchema,
  listMeta,
  paginationSchema,
  reorderSchema,
  searchSchema,
  slugSchema,
  sortSchema,
  uuidParamSchema,
} from '../../src/schemas/admin/common.schema.js'
import { parseAttributeFilters } from '../../src/schemas/shop/catalog.schema.js'

/**
 * The request boundary. Everything downstream is written assuming these have
 * already coerced the strings a query string is made of into the types the
 * services expect — so a gap here is not a validation message, it is a `NaN`
 * reaching Prisma or an unindexed column reaching an ORDER BY.
 */

const UUID = '11111111-1111-4111-8111-111111111111'

describe('paginationSchema', () => {
  it('defaults to the first page', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 25 })
  })

  it('coerces the strings a query string actually carries', () => {
    expect(paginationSchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 })
  })

  /** An unbounded limit is a free way to make the database do arbitrary work. */
  it('refuses a limit above the ceiling', () => {
    expect(paginationSchema.safeParse({ limit: '1000' }).success).toBe(false)
  })

  it('refuses a page before the first', () => {
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false)
    expect(paginationSchema.safeParse({ page: '-1' }).success).toBe(false)
  })

  it('refuses a fractional page rather than truncating it', () => {
    expect(paginationSchema.safeParse({ page: '1.5' }).success).toBe(false)
  })

  it('refuses something that is not a number at all', () => {
    expect(paginationSchema.safeParse({ page: 'abc' }).success).toBe(false)
  })
})

describe('sortSchema', () => {
  const sort = sortSchema(['created_at', 'title'] as const, 'created_at:desc')

  it('falls back when nothing is asked for', () => {
    expect(sort.parse(undefined)).toEqual({ field: 'created_at', direction: 'desc' })
  })

  it('reads a column and a direction', () => {
    expect(sort.parse('title:asc')).toEqual({ field: 'title', direction: 'asc' })
    expect(sort.parse('title:desc')).toEqual({ field: 'title', direction: 'desc' })
  })

  it('defaults the direction to ascending', () => {
    expect(sort.parse('title')).toEqual({ field: 'title', direction: 'asc' })
  })

  it('treats any non-desc direction as ascending rather than failing', () => {
    expect(sort.parse('title:sideways')).toEqual({ field: 'title', direction: 'asc' })
  })

  /**
   * The reason the caller passes its own column list: a query string must never
   * reach a column that is not indexed, or one that does not exist — which
   * Prisma answers with a 500.
   */
  it('refuses a column the caller did not allow', () => {
    const parsed = sort.safeParse('password:asc')
    expect(parsed.success).toBe(false)
  })

  it('names the columns it would accept, so the message is actionable', () => {
    const parsed = sort.safeParse('nope:asc')
    expect(parsed.error?.issues[0]?.message).toContain('created_at, title')
  })
})

describe('slugSchema', () => {
  it('accepts a well-formed slug', () => {
    expect(slugSchema.parse('air-max-90')).toBe('air-max-90')
  })

  it('lowercases and trims on the way in', () => {
    expect(slugSchema.parse('  Air-Max-90  ')).toBe('air-max-90')
  })

  it.each([
    ['-leading', 'a leading hyphen'],
    ['trailing-', 'a trailing hyphen'],
    ['double--hyphen', 'a doubled hyphen'],
    ['has space', 'a space'],
    ['punctuation!', 'punctuation'],
    ['', 'an empty string'],
  ])('refuses %s (%s)', (value) => {
    expect(slugSchema.safeParse(value).success).toBe(false)
  })

  it('refuses a slug past the length cap', () => {
    expect(slugSchema.safeParse('a'.repeat(121)).success).toBe(false)
  })
})

describe('searchSchema', () => {
  it('collapses runs of whitespace', () => {
    expect(searchSchema.parse('  air   max  ')).toBe('air max')
  })

  /** An empty search is no search, not a search for nothing. */
  it('turns a blank string into undefined', () => {
    expect(searchSchema.parse('')).toBeUndefined()
    expect(searchSchema.parse('   ')).toBeUndefined()
  })

  it('refuses an overlong query', () => {
    expect(searchSchema.safeParse('a'.repeat(201)).success).toBe(false)
  })
})

describe('booleanQuerySchema', () => {
  it('reads the strings a query string carries', () => {
    expect(booleanQuerySchema.parse('true')).toBe(true)
    expect(booleanQuerySchema.parse('false')).toBe(false)
  })

  /** An absent filter must stay undefined rather than collapsing to false. */
  it('leaves an absent filter undefined', () => {
    expect(booleanQuerySchema.parse(undefined)).toBeUndefined()
  })

  it('refuses anything else rather than treating it as truthy', () => {
    expect(booleanQuerySchema.safeParse('1').success).toBe(false)
    expect(booleanQuerySchema.safeParse('yes').success).toBe(false)
  })
})

describe('uuidParamSchema and reorderSchema', () => {
  it('accepts a uuid', () => {
    expect(uuidParamSchema.parse({ id: UUID })).toEqual({ id: UUID })
  })

  it('refuses anything that is not one', () => {
    expect(uuidParamSchema.safeParse({ id: '42' }).success).toBe(false)
    expect(uuidParamSchema.safeParse({ id: 'undefined' }).success).toBe(false)
  })

  it('refuses a reorder with nothing in it', () => {
    expect(reorderSchema.safeParse({ ids: [] }).success).toBe(false)
  })

  it('refuses a reorder containing a bad id', () => {
    expect(reorderSchema.safeParse({ ids: [UUID, 'nope'] }).success).toBe(false)
  })
})

describe('listMeta', () => {
  it('reports the page count', () => {
    expect(listMeta(100, 1, 25)).toEqual({ page: 1, limit: 25, total: 100, totalPages: 4 })
  })

  it('rounds a partial last page up', () => {
    expect(listMeta(101, 1, 25).totalPages).toBe(5)
  })

  /** An empty list is one empty page, not zero pages the UI cannot render. */
  it('never reports fewer than one page', () => {
    expect(listMeta(0, 1, 25).totalPages).toBe(1)
  })
})

describe('parseAttributeFilters', () => {
  const other = '22222222-2222-4222-8222-222222222222'

  it('reads a single value', () => {
    const filters = parseAttributeFilters({ [`attr:${UUID}`]: other })
    expect(filters.get(UUID)).toEqual([other])
  })

  it('reads a comma-separated list and trims it', () => {
    const filters = parseAttributeFilters({ [`attr:${UUID}`]: ` ${other} , ${UUID} ` })
    expect(filters.get(UUID)).toEqual([other, UUID])
  })

  it('reads a repeated parameter, which Express hands over as an array', () => {
    const filters = parseAttributeFilters({ [`attr:${UUID}`]: [other, UUID] })
    expect(filters.get(UUID)).toEqual([other, UUID])
  })

  it('ignores keys that are not attribute filters', () => {
    expect(parseAttributeFilters({ page: '1', sort: 'featured' }).size).toBe(0)
  })

  /** A stale bookmark pointing at a deleted attribute should still render a grid. */
  it('ignores a malformed attribute id rather than rejecting the request', () => {
    expect(parseAttributeFilters({ 'attr:not-a-uuid': other }).size).toBe(0)
  })

  it('drops values that are not uuids, keeping the ones that are', () => {
    const filters = parseAttributeFilters({ [`attr:${UUID}`]: `${other},garbage` })
    expect(filters.get(UUID)).toEqual([other])
  })

  it('omits the filter entirely when no value survives', () => {
    expect(parseAttributeFilters({ [`attr:${UUID}`]: 'garbage,more-garbage' }).size).toBe(0)
  })

  /**
   * This becomes an IN clause. An unbounded one is a free way to make the
   * database do arbitrary work.
   */
  it('caps the fan-out at fifty values', () => {
    const many = Array.from({ length: 80 }, () => other).join(',')
    expect(parseAttributeFilters({ [`attr:${UUID}`]: many }).get(UUID)).toHaveLength(50)
  })

  /** A nested query object used to stringify to '[object Object]' and be split. */
  it('ignores a value that is neither a string nor an array', () => {
    expect(parseAttributeFilters({ [`attr:${UUID}`]: { nested: 'value' } }).size).toBe(0)
    expect(parseAttributeFilters({ [`attr:${UUID}`]: 42 }).size).toBe(0)
  })

  it('reads several attributes at once', () => {
    const filters = parseAttributeFilters({
      [`attr:${UUID}`]: other,
      [`attr:${other}`]: UUID,
    })
    expect(filters.size).toBe(2)
  })
})
