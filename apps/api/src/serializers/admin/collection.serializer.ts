import type { Collection, CollectionRule } from '@shoe/db'
import type { AdminProductPayload } from './product.serializer.js'

type CollectionWithExtras = Collection & {
  rules?: CollectionRule[]
  _count?: { products: number }
  /** Computed: manual membership counted, dynamic membership matched. */
  productCount?: number
  /** Manual: the ordered list. Dynamic: the current matches. */
  products?: AdminProductPayload[]
  /** Set when a dynamic collection's rules could not be resolved. */
  ruleError?: string | null
}

export function serializeAdminCollectionRule(rule: CollectionRule) {
  return {
    id: rule.id,
    field: rule.field,
    operator: rule.operator,
    // Stored as jsonb because what it holds depends on the field — a uuid, a
    // number, a date string. The engine is the only thing that knows which.
    value: rule.value,
    groupId: rule.groupId,
  }
}

export function serializeAdminCollection(collection: CollectionWithExtras) {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    imageUrl: collection.imageUrl,
    type: collection.type,
    matchType: collection.matchType,
    status: collection.status,

    /**
     * For MANUAL this is the pinned list's length. For DYNAMIC it is how many
     * products the rules match right now — a number that can change without
     * anybody editing the collection, which is the whole point of it.
     */
    productCount: collection.productCount ?? collection._count?.products ?? 0,

    // `null` rather than `[]` so the UI can tell "no rules" from "rules were
    // not asked for".
    rules: collection.rules ? collection.rules.map(serializeAdminCollectionRule) : null,
    products: collection.products ?? null,
    /** A rule pointing at a deleted brand or attribute. Shown, never swallowed. */
    ruleError: collection.ruleError ?? null,

    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  }
}

export type AdminCollectionPayload = ReturnType<typeof serializeAdminCollection>
