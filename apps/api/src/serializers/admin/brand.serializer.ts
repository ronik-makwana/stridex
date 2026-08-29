import type { Brand } from '@shoe/db'

/** What `_count: { products: true }` adds when the list asks for it. */
type BrandWithCount = Brand & { _count?: { products: number } }

export function serializeAdminBrand(brand: BrandWithCount) {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logoUrl: brand.logoUrl,
    status: brand.status,
    // Always present, so the UI never has to branch on "did this endpoint
    // include counts" before deciding whether delete is allowed.
    productCount: brand._count?.products ?? 0,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  }
}

export type AdminBrandPayload = ReturnType<typeof serializeAdminBrand>
