/**
 * Slugs are permanent URLs, so this stays deliberately conservative: strip
 * accents, drop anything that is not a letter, digit or hyphen, collapse the
 * rest. Non-latin scripts reduce to '', which callers must handle rather than
 * shipping a slug of punctuation.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '')
}

/**
 * Finds the first free variant of `base` — `nike`, `nike-2`, `nike-3` — using
 * whatever the caller already knows is taken.
 *
 * This is a convenience for *derived* slugs only. It is not a uniqueness
 * guarantee: two concurrent creates can both read the same free slug, and the
 * unique index is what actually settles it. An explicitly typed slug must never
 * be silently renamed this way — that request gets a 409 instead.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}
