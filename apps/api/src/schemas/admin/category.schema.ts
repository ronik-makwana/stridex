import { z } from 'zod'
import {
  entityStatusSchema,
  paginationSchema,
  searchSchema,
  slugSchema,
  sortSchema,
} from './common.schema.js'

/**
 * How many levels the tree is allowed to hold, counting the roots. `level` is
 * 0-based, so the deepest legal value is `MAX_CATEGORY_DEPTH - 1`.
 *
 * A cap has to exist somewhere: `level` is derived server side and every move
 * rewrites it for a whole subtree, and the admin tree indents per level. Four
 * is well past what a shoe catalogue needs (Shoes > Men > Running) and leaves
 * room to insert a level without a migration.
 */
export const MAX_CATEGORY_DEPTH = 4

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Use at most 120 characters')

/**
 * Long-form copy for the storefront category page. `''` from a cleared textarea
 * means "remove it", not a validation failure. `.optional()` is outermost so an
 * absent key on a PATCH stays absent rather than parsing to `null` and quietly
 * clearing the column.
 */
const descriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Use at most 2000 characters')
  .nullable()
  .transform((value) => value || null)
  .optional()

/** `null` is a real value here — it means "top level" — so it is not `.nullish()`. */
const parentIdSchema = z.uuid('Not a valid id').nullable().optional()

/**
 * `?parentId=root` lists the top level; a uuid lists one node's direct
 * children. Absent lists the whole tree flat, which is what the search box uses.
 */
const parentFilterSchema = z.union([z.literal('root'), z.uuid('Not a valid id')]).optional()

export const categoryListQuerySchema = paginationSchema.extend({
  q: searchSchema,
  status: entityStatusSchema.optional(),
  parentId: parentFilterSchema,
  sort: sortSchema(
    ['name', 'position', 'level', 'status', 'created_at', 'updated_at'],
    'position:asc',
  ),
})

export const createCategorySchema = z.object({
  name: nameSchema,
  // Optional: the service derives it from the name when the form leaves it
  // untouched, which is the common path.
  slug: slugSchema.optional(),
  description: descriptionSchema,
  // Absent or null both mean a root category. `level` is never accepted from
  // the client — it is the parent's level plus one, and nothing else.
  parentId: parentIdSchema,
  status: entityStatusSchema.default('ACTIVE'),
})

/**
 * PATCH semantics: absent means "leave it", `null` on a nullable field means
 * "clear it" — which for `parentId` is "move to the top level".
 *
 * `position` is not here. Ordering is a drag, and a drag goes to
 * `PATCH /categories/reorder`, which settles the whole affected sibling row at
 * once instead of letting two edits both claim position 3.
 */
export const updateCategorySchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema,
    parentId: parentIdSchema,
    status: entityStatusSchema.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, 'Nothing to update')

export const categoryStatusSchema = z.object({ status: entityStatusSchema })

/**
 * What to do with the children of the category being deleted.
 *
 * `block` — the default, and deliberately so: refuse and say how many there
 * are. `reparent` moves them up to the deleted node's own parent, which is the
 * only other outcome that does not silently destroy a subtree.
 */
export const categoryDeleteQuerySchema = z.object({
  childAction: z.enum(['block', 'reparent']).default('block'),
})

/**
 * One drag can move a node under a new parent *and* renumber its new siblings,
 * so a move carries both. The server still owns the final numbers — it sorts by
 * what arrived and rewrites positions from the index, the same rule
 * `reorderSchema` follows for flat lists.
 */
export const categoryReorderSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.uuid('Not a valid id'),
        parentId: z.uuid('Not a valid id').nullable(),
        position: z.coerce.number().int().min(0),
      }),
    )
    .min(1, 'Nothing to reorder')
    .max(500, 'Too many moves in one request'),
})

export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>
export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type CategoryStatusInput = z.infer<typeof categoryStatusSchema>
export type CategoryDeleteQuery = z.infer<typeof categoryDeleteQuerySchema>
export type CategoryReorderInput = z.infer<typeof categoryReorderSchema>
export type CategoryMove = CategoryReorderInput['moves'][number]
