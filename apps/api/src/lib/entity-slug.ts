import { badRequest, conflict } from './errors.js'
import { slugify, uniqueSlug } from './slug.js'

type Lookup = {
  /** The row already holding `slug`, if any. Scope it to the parent for nested values. */
  findBySlug: (slug: string) => Promise<{ id: string } | null>
  /** Every row whose slug starts with `base`, for the `-2`, `-3` walk. */
  findByPrefix: (base: string) => Promise<{ id: string; slug: string }[]>
}

/**
 * The slug rule every named entity follows, kept in one place because the
 * asymmetry in it is easy to get wrong on the second copy:
 *
 * An explicit slug is honoured verbatim — a 409 if taken, so the operator can
 * see and fix what they typed. A derived one is quietly disambiguated, because
 * nobody typed it and a failed create there is a dead end.
 *
 * `excludeId` is the row being updated, which is allowed to hold its own slug.
 * Uniqueness is still settled by the database index: two concurrent creates can
 * read the same free slug, and the loser gets a P2002 the handler turns into a
 * 409.
 */
export async function resolveSlug(options: {
  name: string
  explicit?: string
  excludeId?: string
  lookup: Lookup
}): Promise<string> {
  const { name, explicit, excludeId, lookup } = options

  if (explicit) {
    const clash = await lookup.findBySlug(explicit)
    if (clash && clash.id !== excludeId) {
      throw conflict('That slug is already in use', { slug: 'Already in use' })
    }
    return explicit
  }

  const base = slugify(name)
  if (!base) {
    throw badRequest('Could not build a slug from that name', {
      slug: 'Enter a slug — the name has no letters or digits to derive one from',
    })
  }

  const neighbours = await lookup.findByPrefix(base)
  return uniqueSlug(
    base,
    neighbours.filter((row) => row.id !== excludeId).map((row) => row.slug),
  )
}
