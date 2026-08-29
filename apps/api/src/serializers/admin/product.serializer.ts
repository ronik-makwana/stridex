import type {
  Attribute,
  AttributeValue,
  Brand,
  Category,
  Inventory,
  Prisma,
  Product,
  ProductAttribute,
  ProductMedia,
  ProductVariant,
  ProductVariantOption,
  VariantOption,
  VariantOptionValue,
} from '@shoe/db'

/**
 * Money leaves as a fixed-point string, never a float. `Decimal(12,2)` survives
 * the trip intact that way, and JSON numbers do not — 8999.95 is not a value
 * IEEE-754 can hold exactly, and a price that drifts by a paisa between the
 * grid and the order is a bug nobody can reproduce.
 */
const money = (value: Prisma.Decimal | null): string | null =>
  value === null ? null : value.toFixed(2)

// ─── media ───────────────────────────────────────────────────────────────────

export function serializeAdminProductMedia(media: ProductMedia) {
  return {
    id: media.id,
    productId: media.productId,
    url: media.url,
    altText: media.altText,
    type: media.type,
    sortOrder: media.sortOrder,
    /** Position 0 is the cover. Derived rather than stored: one source of truth. */
    isCover: media.sortOrder === 0,
    createdAt: media.createdAt,
  }
}

// ─── attributes on a product ─────────────────────────────────────────────────

type ProductAttributeWithRefs = ProductAttribute & {
  attribute: Attribute
  attributeValue: AttributeValue | null
}

/**
 * Flattened deliberately. The editor renders one row per stored row and needs
 * the attribute's type to pick a control and its unit to label the input, so
 * shipping the nested records would just mean the client re-flattening them.
 */
export function serializeAdminProductAttribute(row: ProductAttributeWithRefs) {
  return {
    id: row.id,
    attributeId: row.attributeId,
    name: row.attribute.name,
    slug: row.attribute.slug,
    type: row.attribute.type,
    unit: row.attribute.unit,
    isFilterable: row.attribute.isFilterable,
    attributeValueId: row.attributeValueId,
    /** The chosen option's label, for SELECT and MULTI_SELECT. */
    valueLabel: row.attributeValue?.value ?? null,
    valueText: row.valueText,
    valueNumber: money(row.valueNumber),
    valueBoolean: row.valueBoolean,
    position: row.position,
  }
}

// ─── the options a product builds variants from ──────────────────────────────

type ProductVariantOptionWithRefs = ProductVariantOption & {
  variantOption: VariantOption & { values?: VariantOptionValue[] }
}

export function serializeAdminProductVariantOption(row: ProductVariantOptionWithRefs) {
  return {
    id: row.id,
    variantOptionId: row.variantOptionId,
    name: row.variantOption.name,
    slug: row.variantOption.slug,
    /** 0-based. Drives the Option 1 / Option 2 labels and the SKU token order. */
    position: row.position,
    // Every value the option offers, not only the ones in use: the picker ticks
    // boxes against the full list, and an unticked value has no variant to
    // discover it from.
    values: (row.variantOption.values ?? []).map((value) => ({
      id: value.id,
      value: value.value,
      slug: value.slug,
      swatchHex: value.swatchHex,
      position: value.position,
    })),
  }
}

// ─── variants ────────────────────────────────────────────────────────────────

type VariantWithRefs = ProductVariant & {
  inventory: Inventory | null
  optionAssignments: {
    optionValueId: string
    optionValue: VariantOptionValue & { variantOption?: VariantOption }
  }[]
}

export function serializeAdminVariant(variant: VariantWithRefs) {
  const quantity = variant.inventory?.quantity ?? 0
  const reserved = variant.inventory?.reservedQuantity ?? 0

  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    barcode: variant.barcode,
    price: money(variant.price)!,
    compareAtPrice: money(variant.compareAtPrice),
    mediaId: variant.mediaId,
    position: variant.position,
    status: variant.status,
    /**
     * All three numbers, because admin is the one audience allowed to see them.
     * `available` is what can still be sold; `reserved` is what a pending order
     * is holding. The storefront gets a bucket instead — see the shop
     * serializers in phase 11.
     */
    stock: {
      quantity,
      reserved,
      available: quantity - reserved,
      lowStockThreshold: variant.inventory?.lowStockThreshold ?? 0,
    },
    /** In the product's option order, so the grid's columns line up. */
    options: variant.optionAssignments.map((assignment) => ({
      optionValueId: assignment.optionValueId,
      variantOptionId: assignment.optionValue.variantOptionId,
      optionName: assignment.optionValue.variantOption?.name ?? null,
      value: assignment.optionValue.value,
      swatchHex: assignment.optionValue.swatchHex,
    })),
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  }
}

// ─── the product itself ──────────────────────────────────────────────────────

type CategoryRef = Pick<Category, 'id' | 'name' | 'slug'>

type ProductWithExtras = Product & {
  brand?: Pick<Brand, 'id' | 'name' | 'slug'> | null
  category?: CategoryRef | null
  media?: ProductMedia[]
  /** Set by the list service, which loads the cover alone and drops `media`. */
  coverUrl?: string | null
  attributes?: ProductAttributeWithRefs[]
  variantOptions?: ProductVariantOptionWithRefs[]
  variants?: VariantWithRefs[]
  _count?: { variants: number; media: number }
  /** Computed by the service — one grouped query, not one per row. */
  totalStock?: number
  variantCount?: number
  mediaCount?: number
  /** Root first, self excluded. Lets the list render 'Men > Running'. */
  categoryAncestors?: CategoryRef[]
}

/**
 * One serializer for the list row and the editor. The difference is what the
 * service loaded: the list omits `media`, `attributes`, `variantOptions` and
 * `variants`, and those come back `null` rather than `[]` so the editor can
 * tell "this product has no variants" from "the list endpoint did not ask".
 */
export function serializeAdminProduct(product: ProductWithExtras) {
  const media = product.media ?? null
  const ancestors = product.categoryAncestors ?? []

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    status: product.status,
    publishedAt: product.publishedAt,

    brandId: product.brandId,
    brand: product.brand ?? null,
    categoryId: product.categoryId,
    category: product.category ?? null,
    /** 'Shoes > Men > Running'. The one label that identifies a category alone. */
    categoryPath: product.category
      ? [...ancestors.map((ancestor) => ancestor.name), product.category.name].join(' > ')
      : null,

    // The list computes its own cover and omits `media`; everywhere else the
    // gallery is loaded in `sortOrder` order, so the first entry is the cover.
    coverUrl: product.coverUrl ?? media?.[0]?.url ?? null,
    mediaCount: product.mediaCount ?? product._count?.media ?? media?.length ?? 0,
    variantCount: product.variantCount ?? product._count?.variants ?? product.variants?.length ?? 0,
    /** Summed available across variants. Red at zero in the list, even when active. */
    totalStock: product.totalStock ?? 0,

    media: media ? media.map(serializeAdminProductMedia) : null,
    attributes: product.attributes
      ? product.attributes.map(serializeAdminProductAttribute)
      : null,
    variantOptions: product.variantOptions
      ? product.variantOptions.map(serializeAdminProductVariantOption)
      : null,
    variants: product.variants ? product.variants.map(serializeAdminVariant) : null,

    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

export type AdminProductPayload = ReturnType<typeof serializeAdminProduct>
export type AdminProductMediaPayload = ReturnType<typeof serializeAdminProductMedia>
export type AdminVariantPayload = ReturnType<typeof serializeAdminVariant>
