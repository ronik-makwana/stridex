import { z } from 'zod'

/** Every list endpoint speaks this dialect. Keep new filters in the module. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const entityStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])

export const uuidParamSchema = z.object({
  id: z.uuid('Not a valid id'),
})

/**
 * `sort=created_at:desc`. The caller supplies the columns it is willing to sort
 * by, so a query string can never reach a field that is not indexed — or one
 * that does not exist, which Prisma answers with a 500.
 */
export function sortSchema<const T extends readonly [string, ...string[]]>(
  columns: T,
  fallback: `${T[number]}:asc` | `${T[number]}:desc`,
) {
  const column = z.enum(columns)
  return z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      const [rawField, rawDirection = 'asc'] = value.split(':')
      const field = column.safeParse(rawField)
      const direction = rawDirection === 'desc' ? 'desc' : 'asc'

      if (!field.success) {
        ctx.addIssue({
          code: 'custom',
          message: `Cannot sort by "${rawField}". Try one of: ${columns.join(', ')}`,
        })
        return z.NEVER
      }
      return { field: field.data as T[number], direction } as const
    })
}

/** Trims, collapses runs of whitespace, and turns '' into undefined. */
export const searchSchema = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value.replace(/\s+/g, ' ') || undefined)
  .optional()

/**
 * Slugs are URLs forever, so the rules are strict on the way in rather than
 * quietly normalised on the way out: lowercase, digits, single hyphens.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Slug is required')
  .max(120, 'Use at most 120 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

export type PaginationInput = z.infer<typeof paginationSchema>
export type UuidParam = z.infer<typeof uuidParamSchema>

/** The `meta` block every list response carries. */
export function listMeta(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
}
