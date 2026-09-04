import type {
  Brand,
  Inventory,
  InventoryTransaction,
  Product,
  ProductVariant,
  User,
  VariantOptionValue,
} from '@shoe/db'
import { ADJUST_REASONS } from '../../schemas/admin/inventory.schema.js'

/** `reference_type` token → the words an operator chose. */
const REASON_LABELS = new Map<string, string>(
  Object.entries(ADJUST_REASONS).map(([key, reason]) => [`adjust:${key}`, reason.label]),
)

/**
 * What a ledger row was actually about, which the enum alone cannot say: damage
 * and a stock recount are both ADJUSTMENT. Falls back to a readable form of the
 * type for the rows checkout and the product editor write.
 */
function reasonLabel(referenceType: string | null): string | null {
  if (!referenceType) return null
  const known = REASON_LABELS.get(referenceType)
  if (known) return known

  switch (referenceType) {
    case 'restock':
      return 'Restock'
    case 'variant.create':
      return 'Opening stock'
    case 'variant.generate':
      return 'Opening stock from generate'
    case 'variant.update':
    case 'variant.bulk':
      return 'Set from the product editor'
    case 'product.duplicate':
      return 'Copied from another product'
    // Written by checkout, never by a person. On-hand does not move on either —
    // a reservation speaks for units, it does not remove them.
    case 'checkout.reserve':
      return 'Reserved for a checkout'
    case 'checkout.cancel':
      return 'Released — checkout cancelled'
    case 'checkout.expire':
      return 'Released — checkout expired'
    default:
      return null
  }
}

type VariantRow = ProductVariant & {
  inventory: Inventory | null
  product: (Product & { brand: Pick<Brand, 'id' | 'name' | 'slug'> | null }) | null
  optionAssignments?: { optionValue: VariantOptionValue }[]
}

/**
 * One row of the inventory list. All three numbers go out, because admin is the
 * one audience allowed to see them and "0 available against 20 on hand" is
 * nonsense until you can see the 20 reservations underneath it.
 *
 * The storefront gets a bucket instead — see the shop serializers in phase 11.
 */
export function serializeAdminInventoryRow(variant: VariantRow) {
  const quantity = variant.inventory?.quantity ?? 0
  const reserved = variant.inventory?.reservedQuantity ?? 0
  const available = quantity - reserved
  const lowStockThreshold = variant.inventory?.lowStockThreshold ?? 0

  return {
    variantId: variant.id,
    inventoryId: variant.inventory?.id ?? null,
    sku: variant.sku,
    barcode: variant.barcode,
    status: variant.status,

    productId: variant.productId,
    product: variant.product
      ? {
          id: variant.product.id,
          title: variant.product.title,
          slug: variant.product.slug,
          status: variant.product.status,
        }
      : null,
    brand: variant.product?.brand ?? null,

    /** 'Black / 9'. The only thing that tells two SKUs of one product apart. */
    optionLabel:
      variant.optionAssignments && variant.optionAssignments.length > 0
        ? variant.optionAssignments.map((row) => row.optionValue.value).join(' / ')
        : null,

    quantity,
    reserved,
    available,
    lowStockThreshold,
    /** Derived, so the list and the badge can never disagree about a boundary. */
    isOut: available <= 0,
    isLow: available > 0 && available <= lowStockThreshold,

    updatedAt: variant.inventory?.updatedAt ?? variant.updatedAt,
  }
}

type TransactionRow = InventoryTransaction & {
  createdBy: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'> | null
  inventory?: { variant: VariantRow } | null
}

export function serializeAdminInventoryTransaction(row: TransactionRow) {
  const variant = row.inventory?.variant

  return {
    id: row.id,
    type: row.type,
    /**
     * Signed, always. The ledger has to sum to the number on the inventory row,
     * so a reduction is a negative quantity rather than a positive one with a
     * different label — the moment those two disagree the ledger is decoration.
     */
    quantity: row.quantity,
    reason: reasonLabel(row.referenceType),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    note: row.note,
    /** Null means the system wrote it — checkout, or a webhook. */
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          email: row.createdBy.email,
          name:
            [row.createdBy.firstName, row.createdBy.lastName].filter(Boolean).join(' ') || null,
        }
      : null,
    createdAt: row.createdAt,

    // Only the global ledger loads these; the per-variant one already knows.
    variantId: variant?.id ?? null,
    sku: variant?.sku ?? null,
    product: variant?.product
      ? { id: variant.product.id, title: variant.product.title, slug: variant.product.slug }
      : null,
  }
}

export type AdminInventoryRowPayload = ReturnType<typeof serializeAdminInventoryRow>
export type AdminInventoryTransactionPayload = ReturnType<typeof serializeAdminInventoryTransaction>
