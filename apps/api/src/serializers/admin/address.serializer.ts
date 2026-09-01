import type { Address } from '@shoe/db'

/** A customer's saved address, read-only from the admin side. */
export function serializeAdminAddress(address: Address) {
  return {
    id: address.id,
    fullName: address.fullName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    country: address.country,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
  }
}
