import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SHOP_ERROR_CODES } from '../../src/schemas/shop/common.schema.js'

/**
 * The storefront mirrors `SHOP_ERROR_CODES` by hand, and nothing but this
 * connected the two.
 *
 * It drifted: `ORDER_NOT_CANCELLABLE`, `REFUND_ALREADY_REQUESTED` and
 * `RETURN_WINDOW_CLOSED` were live in the API — thrown all over the cancel and
 * return flows — while the client union had never heard of them. It cost
 * nothing only because no screen had tried to branch on one yet. `ApiError.is()`
 * takes that union as its parameter, so the attempt would simply not have
 * compiled, and whoever hit it would have assumed the API did not send the code.
 *
 * ─── why this reads a file as text ──────────────────────────────────────────
 *
 * Because the alternative is worse. Importing the storefront's types here would
 * couple the API's typecheck to a frontend, which is the separation
 * `repo-structure.md` exists to protect; generating the union would mean owning
 * a codegen pipeline for one string list. Reading the file and checking each
 * name appears is crude, costs nothing, and fails at exactly the moment it
 * should — when somebody adds a code to the API and not to the client.
 *
 * If the storefront's types ever move, fix the path here. A failure that says
 * "the file moved" is still cheaper than the silence this replaces.
 */

const STOREFRONT_TYPES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../storefront/src/types/api.ts',
)

describe('SHOP_ERROR_CODES and the storefront union', () => {
  const source = readFileSync(STOREFRONT_TYPES, 'utf8')

  /** Just the `ShopErrorCode` union, so an unrelated mention elsewhere in the
   * file cannot make a missing code look present. */
  const union = source.slice(
    source.indexOf('export type ShopErrorCode'),
    source.indexOf('export type ApiErrorBody'),
  )

  it('finds the storefront type file where it expects it', () => {
    expect(source.length).toBeGreaterThan(0)
    expect(union).toContain('export type ShopErrorCode')
  })

  it.each(Object.values(SHOP_ERROR_CODES))(
    'declares %s on the client, so the UI can branch on it',
    (code) => {
      expect(
        union.includes(`'${code}'`),
        `The API can return "${code}" but ShopErrorCode in apps/storefront/src/types/api.ts ` +
          `does not list it. Add it there — until you do, ApiError.is('${code}') will not compile.`,
      ).toBe(true)
    },
  )

  /**
   * The other direction. A code the client believes in and the API never sends
   * is dead handling — a branch that has never once been taken, which reads as
   * live logic to the next person.
   */
  it('does not declare codes the API cannot send', () => {
    const declared = [...union.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]!)
    const known = new Set<string>(Object.values(SHOP_ERROR_CODES))

    expect(declared.filter((code) => !known.has(code))).toEqual([])
  })
})
