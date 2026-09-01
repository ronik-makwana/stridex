import type { Address } from '@shoe/db'

/**
 * The whole row, minus the owner. `user_id` is never sent: the customer knows
 * whose address book they are reading, and an id the client can see is an id a
 * client can try to send back.
 */
export function serializeShopAddress(address: Address) {
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
    updatedAt: address.updatedAt,
  }
}

export type ShopAddressPayload = ReturnType<typeof serializeShopAddress>
