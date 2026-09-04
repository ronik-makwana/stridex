import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from '../../src/lib/slug.js'

/**
 * Slugs are permanent URLs, so the tests that matter are the ones about what
 * `slugify` refuses to emit: punctuation, a trailing hyphen, or a string long
 * enough to be truncated mid-word into something that then has to live forever.
 */

describe('slugify', () => {
  it('lowercases and hyphenates ordinary titles', () => {
    expect(slugify('Air Max 90')).toBe('air-max-90')
  })

  it('strips accents rather than dropping the letters', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme')
  })

  it('collapses punctuation and runs of separators into one hyphen', () => {
    expect(slugify("Men's  Running   Shoes!!")).toBe('men-s-running-shoes')
  })

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugify('  --- Nike --- ')).toBe('nike')
  })

  it('caps the length', () => {
    expect(slugify('a'.repeat(200))).toHaveLength(120)
  })

  /** The truncation must not leave the hyphen the 120-char cut landed on. */
  it('does not leave a trailing hyphen behind after truncating', () => {
    const slug = slugify(`${'a'.repeat(119)} tail`)
    expect(slug).toHaveLength(119)
    expect(slug.endsWith('-')).toBe(false)
  })

  /** Callers must handle this rather than shipping a slug of punctuation. */
  it('reduces a non-latin script to an empty string', () => {
    expect(slugify('日本語')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})

describe('uniqueSlug', () => {
  it('keeps the base when nothing has claimed it', () => {
    expect(uniqueSlug('nike', [])).toBe('nike')
  })

  it('starts at 2, since the base is the first', () => {
    expect(uniqueSlug('nike', ['nike'])).toBe('nike-2')
  })

  it('walks past every taken variant', () => {
    expect(uniqueSlug('nike', ['nike', 'nike-2', 'nike-3'])).toBe('nike-4')
  })

  it('fills a gap rather than always appending to the end', () => {
    expect(uniqueSlug('nike', ['nike', 'nike-3'])).toBe('nike-2')
  })

  it('ignores unrelated slugs', () => {
    expect(uniqueSlug('nike', ['adidas', 'puma'])).toBe('nike')
  })
})
