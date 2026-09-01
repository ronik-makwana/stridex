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
import { discountPercent, money, moneyOrNull } from './money.js'
import { purchasableQuantity, stockBucket, type StockBucket } from './stock.serializer.js'

/**
 * The customer-facing product payload. Never `serializers/admin/` — that one
 * carries draft status, cost, raw stock counts and `reserved_quantity`, and a
 * shared shape is exactly how those reach a public page.
 *
 * What this file deliberately omits: `status` (a non-ACTIVE product is a 404,
 * so a status field could only ever say "ACTIVE"), `createdAt`/`updatedAt` on
 * variants, `barcode`, and every inventory number.
 */

type BrandRef = Pick<Brand, 'id' | 'name' | 'slug'>
type CategoryRef = Pick<Category, 'id' | 'name' | 'slug'>

type MediaRow = ProductMedia
type AttributeRow = ProductAttribute & { attribute: Attribute; attributeValue: AttributeValue | null }
type OptionRow = ProductVariantOption & {
  variantOption: VariantOption & { values?: VariantOptionValue[] }
}
type VariantRow = ProductVariant & {
  inventory: Inventory | null
  optionAssignments: {
    optionValueId: string
    optionValue: VariantOptionValue & { variantOption?: VariantOption }
  }[]
}

export type ShopProductRecord = Product & {
  brand: BrandRef | null
  category: CategoryRef | null
  media: MediaRow[]
  attributes: AttributeRow[]
  variantOptions: OptionRow[]
  variants: VariantRow[]
}

// ─── media ───────────────────────────────────────────────────────────────────

function serializeMedia(media: MediaRow) {
  return {
    id: media.id,
    url: media.url,
    // Falls back to nothing rather than to the title: an alt text that repeats
    // the heading beside it is noise in a screen reader, and an empty alt on a
    // decorative duplicate is the correct answer.
    altText: media.altText,
    type: media.type,
    sortOrder: media.sortOrder,
  }
}

// ─── attributes, flattened to what a spec table renders ──────────────────────

/**
 * One display string per attribute, resolved here rather than in the browser.
 * The client has no business knowing that a SELECT reads `attributeValue.value`
 * while a NUMBER reads `valueNumber` and needs its unit appended — that is a
 * storage detail, and duplicating the switch in TypeScript is how the spec
 * table and the filter sidebar end up formatting the same value differently.
 */
function attributeDisplayValue(row: AttributeRow): string | null {
  switch (row.attribute.type) {
    case 'SELECT':
    case 'MULTI_SELECT':
      return row.attributeValue?.value ?? null
    case 'NUMBER': {
      if (row.valueNumber === null) return null
      // Trim a trailing `.00`: "10.00 mm" reads like a measurement tolerance
      // nobody promised.
      const n = row.valueNumber.toFixed(2).replace(/\.00$/, '')
      return row.attribute.unit ? `${n} ${row.attribute.unit}` : n
    }
    case 'BOOLEAN':
      if (row.valueBoolean === null) return null
      return row.valueBoolean ? 'Yes' : 'No'
    case 'TEXT':
    default:
      return row.valueText
  }
}

function serializeAttributes(rows: AttributeRow[]) {
  return rows
    .map((row) => ({
      id: row.id,
      attributeId: row.attributeId,
      name: row.attribute.name,
      slug: row.attribute.slug,
      value: attributeDisplayValue(row),
    }))
    // A row with no value is a half-filled admin form, not a spec. Dropping it
    // here keeps "Material —" off the page.
    .filter((row): row is typeof row & { value: string } => Boolean(row.value))
}

// ─── options and variants ────────────────────────────────────────────────────

/**
 * The pickers, in `product_variant_options.position` order — which is the order
 * the admin dragged them into, and the same order the SKU tokens follow.
 *
 * Only values this product actually has ACTIVE variants for are returned. The
 * admin payload sends every value the option defines globally, because its
 * picker ticks boxes against the full list; doing that here would render a size
 * 13 that is permanently disabled on a product that has never been made in a
 * 13, which reads as a broken page rather than a deliberate one.
 */
function serializeOptions(rows: OptionRow[], usedValueIds: Set<string>) {
  return rows
    .map((row) => ({
      id: row.variantOptionId,
      name: row.variantOption.name,
      slug: row.variantOption.slug,
      position: row.position,
      values: (row.variantOption.values ?? [])
        .filter((value) => usedValueIds.has(value.id))
        .map((value) => ({
          id: value.id,
          value: value.value,
          slug: value.slug,
          /** Drives the colour swatches. Null for non-colour axes like Size. */
          swatchHex: value.swatchHex,
          position: value.position,
        })),
    }))
    // An option axis with nothing left to pick is not a picker.
    .filter((option) => option.values.length > 0)
}

/**
 * @param optionPosition variantOptionId -> this product's own axis order.
 */
function serializeVariant(variant: VariantRow, optionPosition: Map<string, number>) {
  const bucket = stockBucket(variant.inventory)
  return {
    id: variant.id,
    sku: variant.sku,
    price: money(variant.price),
    /**
     * Catalog markdown. Already inside `price` — it is a strikethrough and a
     * pill, and it must never appear in an order summary as a deduction, or
     * the product is discounted twice (§15.3).
     */
    compareAtPrice: moneyOrNull(variant.compareAtPrice),
    discountPercent: discountPercent(variant.price, variant.compareAtPrice),
    /**
     * Which option values this variant is. The client resolves a selection to a
     * variant against these, and any combination with no match is disabled —
     * which is why the whole variant list ships in one payload rather than
     * being queried per selection. Thirty-five rows is nothing; a round trip
     * per size tap is a broken picker.
     */
    optionValueIds: [...variant.optionAssignments]
      /*
       * Sorted into the product's own axis order — Size then Colour here —
       * because the database returns join rows in whatever order it likes, and
       * an unsorted array had one variant reading "Black / 4" among siblings
       * reading "4 / Beige".
       *
       * Matching a selection to a variant is set-based, so this is not a
       * correctness fix. It is a determinism one: the moment anything renders
       * this array in order — a cart line label, an order-item snapshot in
       * Phase 15 — an arbitrary order becomes a visible inconsistency that is
       * miserable to trace back to a missing ORDER BY.
       *
       * Sorted by `product_variant_options.position`, not the option's own
       * global position: the axis order belongs to the product.
       */
      .sort(
        (a, b) =>
          (optionPosition.get(a.optionValue.variantOptionId) ?? 0) -
          (optionPosition.get(b.optionValue.variantOptionId) ?? 0),
      )
      .map((a) => a.optionValueId),
    /** Bucket, never a count (§18). */
    stock: bucket,
    /** Bounded by MAX_QUANTITY_PER_ITEM, so it leaks no more than "under ten". */
    maxQuantity: purchasableQuantity(variant.inventory),
    /**
     * Which image to show when this variant is chosen — the mechanism behind
     * "picking a colour swaps the gallery". Null across the whole catalogue
     * today because nothing in admin sets it yet; the client treats null as
     * "leave the gallery alone", so this starts working the day media is
     * assigned, with no client change.
     */
    mediaId: variant.mediaId,
  }
}

// ─── the product ─────────────────────────────────────────────────────────────

/** Cheapest and dearest sellable price, for the header before a size is picked. */
function priceRange(variants: { price: Prisma.Decimal }[]) {
  if (variants.length === 0) return null
  let min = variants[0]!.price
  let max = variants[0]!.price
  for (const v of variants) {
    if (v.price.lessThan(min)) min = v.price
    if (v.price.greaterThan(max)) max = v.price
  }
  return { min: money(min), max: money(max) }
}

/** A product is sold out only when every one of its variants is. */
function overallStock(buckets: StockBucket[]): StockBucket {
  if (buckets.some((b) => b === 'IN_STOCK')) return 'IN_STOCK'
  if (buckets.some((b) => b === 'LOW_STOCK')) return 'LOW_STOCK'
  return 'SOLD_OUT'
}

export function serializeShopProduct(
  product: ShopProductRecord,
  breadcrumbs: CategoryRef[] = [],
) {
  // ARCHIVED and DRAFT variants are invisible, which is also what creates the
  // gaps the picker renders as disabled combinations.
  const activeVariants = product.variants.filter((v) => v.status === 'ACTIVE')
  const usedValueIds = new Set(activeVariants.flatMap((v) => v.optionAssignments.map((a) => a.optionValueId)))
  const optionPosition = new Map(product.variantOptions.map((o) => [o.variantOptionId, o.position]))
  const variants = activeVariants.map((v) => serializeVariant(v, optionPosition))

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    /** Root first, this product's category last: 'Shoes / Men / Sneakers'. */
    breadcrumbs: product.category ? [...breadcrumbs, product.category] : breadcrumbs,
    media: product.media.map(serializeMedia),
    attributes: serializeAttributes(product.attributes),
    options: serializeOptions(product.variantOptions, usedValueIds),
    variants,
    priceRange: priceRange(activeVariants),
    stock: overallStock(variants.map((v) => v.stock)),
    publishedAt: product.publishedAt,
  }
}

export type ShopProductPayload = ReturnType<typeof serializeShopProduct>

// ─── the card, for grids and "you may also like" ─────────────────────────────

export type ShopProductCardRecord = Product & {
  brand: BrandRef | null
  media: MediaRow[]
  variants: (ProductVariant & { inventory: Inventory | null })[]
}

/**
 * Deliberately much smaller than the detail payload: a 24-card grid that ships
 * every variant of every product is a slow page. The card needs a picture, a
 * name, a price and whether it is buyable — resolving a size happens on the
 * product page.
 */
export type CardRating = { average: number; count: number }

const NO_REVIEWS: CardRating = { average: 0, count: 0 }

export function serializeShopProductCard(
  product: ShopProductCardRecord,
  rating: CardRating = NO_REVIEWS,
) {
  const activeVariants = product.variants.filter((v) => v.status === 'ACTIVE')

  // The price shown is the cheapest sellable one, and the markdown shown is
  // that same variant's — not the deepest discount anywhere in the product.
  // Advertising a 40% off that belongs to a size 12 nobody wanted is the
  // classic bait complaint.
  let cheapest = activeVariants[0]
  for (const v of activeVariants) if (v.price.lessThan(cheapest!.price)) cheapest = v

  const cover = product.media[0]

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    brand: product.brand,
    image: cover ? { url: cover.url, altText: cover.altText } : null,
    price: cheapest ? money(cheapest.price) : null,
    compareAtPrice: cheapest ? moneyOrNull(cheapest.compareAtPrice) : null,
    discountPercent: cheapest ? discountPercent(cheapest.price, cheapest.compareAtPrice) : null,
    stock: overallStock(activeVariants.map((v) => stockBucket(v.inventory))),
    /**
     * Batched in by the caller from one grouped query, and always present —
     * `{ average: 0, count: 0 }` for a product nobody has reviewed. Every card
     * renders the row, so the grid keeps one consistent shape rather than some
     * cards being a line taller than their neighbours.
     */
    rating: rating.count > 0 ? rating : NO_REVIEWS,
  }
}

export type ShopProductCardPayload = ReturnType<typeof serializeShopProductCard>
