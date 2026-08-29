import type { Attribute, AttributeValue } from '@shoe/db'

/**
 * `productCount` is a distinct count of products, not of `product_attributes`
 * rows: a MULTI_SELECT attribute writes one row per selected value, so counting
 * rows would report three products as five. The service computes it separately
 * and passes it in.
 */
type AttributeValueWithCount = AttributeValue & { productCount?: number }

type AttributeWithExtras = Attribute & {
  _count?: { values: number }
  values?: AttributeValueWithCount[]
  productCount?: number
}

export function serializeAdminAttributeValue(value: AttributeValueWithCount) {
  return {
    id: value.id,
    attributeId: value.attributeId,
    value: value.value,
    slug: value.slug,
    position: value.position,
    // Always present, so the UI never has to branch on "did this endpoint
    // include counts" before deciding whether delete is allowed.
    productCount: value.productCount ?? 0,
    createdAt: value.createdAt,
  }
}

export function serializeAdminAttribute(attribute: AttributeWithExtras) {
  return {
    id: attribute.id,
    name: attribute.name,
    slug: attribute.slug,
    type: attribute.type,
    unit: attribute.unit,
    isFilterable: attribute.isFilterable,
    isSuggested: attribute.isSuggested,
    position: attribute.position,
    valueCount: attribute._count?.values ?? attribute.values?.length ?? 0,
    productCount: attribute.productCount ?? 0,
    // Only the detail endpoint loads them. `null` rather than `[]` so the UI can
    // tell "no values" from "values were not asked for".
    values: attribute.values ? attribute.values.map(serializeAdminAttributeValue) : null,
    createdAt: attribute.createdAt,
    updatedAt: attribute.updatedAt,
  }
}

export type AdminAttributePayload = ReturnType<typeof serializeAdminAttribute>
export type AdminAttributeValuePayload = ReturnType<typeof serializeAdminAttributeValue>
