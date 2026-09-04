import { z } from 'zod'
import { shopPaginationSchema } from './common.schema.js'

/**
 * The sort allow-list. Anything outside it is a 400, never a silent fallback to
 * newest — a mistyped `sort=pirce_asc` that quietly returns newest is a bug
 * found in production, months later, by a merchandiser who cannot explain why
 * their link looks wrong.
 */
export const PRODUCT_SORTS = ['featured', 'newest', 'price_asc', 'price_desc', 'name_asc'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]

const csv = (max: number) =>
  z
    .string()
    .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.uuid('Not a valid id')).max(max))
    .optional()

/** Money arrives as a string and stays one until Prisma turns it into Decimal. */
const priceSchema = z.preprocess(blankToUndefined, z.coerce.number().min(0).max(10_000_000).optional())

/**
 * `?sort=&category=` is what a UI sends when it clears a filter, and it means
 * "not set" — not "set to the empty string". Without this, clearing the sort
 * 400s the page and clearing the category 404s it.
 *
 * This is not the silent fallback the sort allow-list forbids: a *wrong* value
 * like `sort=pirce_asc` still fails loudly. Only absence is treated as absence.
 */
function blankToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

export const productListQuerySchema = shopPaginationSchema.extend({
  category: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  collection: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  /** `brand=id,id` — multi-select within one facet is an OR. */
  brand: csv(50),
  minPrice: priceSchema,
  maxPrice: priceSchema,
  q: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  sort: z.preprocess(blankToUndefined, z.enum(PRODUCT_SORTS).default('featured')),
})

export type ProductListQuery = z.infer<typeof productListQuerySchema>

/**
 * Attribute filters arrive as `attr:<attributeId>=<valueId>,<valueId>` and
 * cannot be expressed in a Zod object schema, because the keys are data. Parsed
 * separately, and unknown or malformed keys are ignored rather than rejected —
 * a stale bookmark pointing at a deleted attribute should still render a grid.
 */
export function parseAttributeFilters(query: Record<string, unknown>): Map<string, string[]> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const filters = new Map<string, string[]>()

  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith('attr:')) continue
    const attributeId = key.slice(5)
    if (!uuid.test(attributeId)) continue

    // Express hands query values as a string or an array of them. Anything
    // else — a nested object from `?attr:x[y]=z` — is not a filter this
    // understands, and stringifying it produced '[object Object]' to split on.
    const joined = Array.isArray(raw)
      ? raw.filter((part): part is string => typeof part === 'string').join(',')
      : typeof raw === 'string'
        ? raw
        : ''

    const values = joined
      .split(',')
      .map((part) => part.trim())
      .filter((part) => uuid.test(part))

    // Cap the fan-out: this becomes an IN clause, and an unbounded one is a
    // free way to make the database do arbitrary work.
    if (values.length > 0) filters.set(attributeId, values.slice(0, 50))
  }

  return filters
}

export const searchQuerySchema = shopPaginationSchema.extend({
  q: z.string().trim().min(1, 'Type something to search for').max(200),
  sort: z.preprocess(blankToUndefined, z.enum(PRODUCT_SORTS).default('featured')),
})

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
