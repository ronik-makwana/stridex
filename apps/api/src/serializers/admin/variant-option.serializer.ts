import type { VariantOption, VariantOptionValue } from '@shoe/db'

/**
 * Counts come straight from `_count` here, unlike attributes. Both joins are
 * already one row per thing being counted: `product_variant_options` is
 * unique(product, option) and `variant_option_assignments` is keyed on
 * (variant, value), so there is nothing to de-duplicate.
 */
type VariantOptionValueWithCount = VariantOptionValue & {
  _count?: { assignments: number }
}

type VariantOptionWithExtras = VariantOption & {
  _count?: { values: number; productVariantOptions: number }
  values?: VariantOptionValueWithCount[]
}

export function serializeAdminVariantOptionValue(value: VariantOptionValueWithCount) {
  return {
    id: value.id,
    variantOptionId: value.variantOptionId,
    value: value.value,
    slug: value.slug,
    swatchHex: value.swatchHex,
    position: value.position,
    /** Variants already built on this value — the whole blast radius of a delete. */
    variantCount: value._count?.assignments ?? 0,
    createdAt: value.createdAt,
  }
}

export function serializeAdminVariantOption(option: VariantOptionWithExtras) {
  return {
    id: option.id,
    name: option.name,
    slug: option.slug,
    position: option.position,
    valueCount: option._count?.values ?? option.values?.length ?? 0,
    productCount: option._count?.productVariantOptions ?? 0,
    // Only the detail endpoint loads them. `null` rather than `[]` so the UI can
    // tell "no values" from "values were not asked for".
    values: option.values ? option.values.map(serializeAdminVariantOptionValue) : null,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  }
}

export type AdminVariantOptionPayload = ReturnType<typeof serializeAdminVariantOption>
export type AdminVariantOptionValuePayload = ReturnType<typeof serializeAdminVariantOptionValue>
